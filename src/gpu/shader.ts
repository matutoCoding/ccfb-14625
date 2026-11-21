// 重算着色器：与 src/core/georef.ts 的 CPU 参考路径一一对应
// 一波束一线程：姿态/安装偏差 → 导航系出射角与方位角 → 分层常梯度追踪 → NED 坐标与图深

export const RECOMPUTE_WGSL = /* wgsl */ `
struct Params {
  mounting: vec4f, // roll pitch heading latency（度）
  lever: vec4f,    // 杆臂 x y z + 吃水
  sigmas: vec4f,   // 潮位 升沉 横摇(度) 声速测时
  trunc: vec4f,    // 正下方截断角(度) 外侧截断角(度) 0 0
  casts: array<vec4u, 8>, // 每套剖面 (层偏移, 层数, 0, 0)
}
struct Dims { nBeams: u32, nPings: u32, nCasts: u32, pad: u32 }

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> dims: Dims;
@group(0) @binding(2) var<storage, read> layers: array<vec4f>; // z0 z1 c0 g
@group(0) @binding(3) var<storage, read> pings: array<vec4f>;  // 每 ping 两个 vec4
@group(0) @binding(4) var<storage, read> beams: array<vec2f>;  // 出射角(rad) 双程旅行时(s)
@group(0) @binding(5) var<storage, read_write> outBuf: array<vec4f>; // 每波束两个 vec4

const D2R: f32 = 0.017453292519943295;
const G_EPS: f32 = 1e-9;
const P_EPS: f32 = 1e-9;

// 列主序构造，与 CPU 端行主序 Rx/Ry/Rz 等价
fn rotX(d: f32) -> mat3x3f {
  let c = cos(d); let s = sin(d);
  return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, c, s), vec3f(0.0, -s, c));
}
fn rotY(d: f32) -> mat3x3f {
  let c = cos(d); let s = sin(d);
  return mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
}
fn rotZ(d: f32) -> mat3x3f {
  let c = cos(d); let s = sin(d);
  return mat3x3f(vec3f(c, s, 0.0), vec3f(-s, c, 0.0), vec3f(0.0, 0.0, 1.0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let beamIdx = gid.x;
  let pingIdx = gid.y;
  if (pingIdx >= dims.nPings || beamIdx >= dims.nBeams) { return; }
  let outBase = (pingIdx * dims.nBeams + beamIdx) * 2u;
  let b = beams[pingIdx * dims.nBeams + beamIdx];
  let beta = b.x;
  let ttw = b.y;
  let p0 = pings[pingIdx * 2u];      // e n heading pitch
  let p1 = pings[pingIdx * 2u + 1u]; // roll heave tide castIdx
  // 角度截断：正下方与外侧分开设限
  let betaDeg = abs(beta) / D2R;
  if (betaDeg < params.trunc.x || betaDeg > params.trunc.y) {
    outBuf[outBase] = vec4f(0.0);
    outBuf[outBase + 1u] = vec4f(0.0, 3.0, 0.0, 0.0);
    return;
  }
  if (ttw <= 0.0) {
    outBuf[outBase] = vec4f(0.0);
    outBuf[outBase + 1u] = vec4f(0.0, 2.0, 0.0, 0.0);
    return;
  }
  // 姿态与安装偏差矩阵
  let mAtt = rotZ(p0.z * D2R) * (rotY(p0.w * D2R) * rotX(p1.x * D2R));
  let mMount = rotZ(params.mounting.z * D2R) * (rotY(params.mounting.y * D2R) * rotX(params.mounting.x * D2R));
  let dirBody = vec3f(0.0, sin(beta), cos(beta));
  let dirNav = mAtt * (mMount * dirBody);
  let down = dirNav.z;
  if (down <= 0.0) {
    outBuf[outBase] = vec4f(0.0);
    outBuf[outBase + 1u] = vec4f(0.0, 2.0, 0.0, 0.0);
    return;
  }
  let horiz = length(dirNav.xy);
  var theta = atan2(horiz, down);
  let azimuth = atan2(dirNav.y, dirNav.x);
  // 分层常梯度追踪
  let cast = params.casts[u32(p1.w)];
  let layerOff = cast.x;
  let layerCnt = cast.y;
  var tLeft = ttw * 0.5;
  var x = 0.0;
  var z = 0.0;
  var okFlag = 1.0;
  let c0 = layers[layerOff].z;
  var p = sin(theta) / c0;
  for (var i = 0u; i < layerCnt; i++) {
    if (tLeft <= 0.0) { break; }
    let L = layers[layerOff + i];
    let dzLayer = L.y - L.x;
    let g = L.w;
    if (abs(g) < G_EPS) {
      let cosT = cos(theta);
      if (cosT <= 0.0) { okFlag = 2.0; break; }
      let tFull = dzLayer / (L.z * cosT);
      let dt = min(tFull, tLeft);
      x += L.z * dt * sin(theta);
      z += L.z * dt * cosT;
      tLeft -= dt;
      continue;
    }
    if (abs(p) < P_EPS) {
      let c1 = L.z + g * dzLayer;
      let tFull = log(c1 / L.z) / g;
      let dt = min(tFull, tLeft);
      let cEnd = L.z * exp(g * dt);
      z += (cEnd - L.z) / g;
      tLeft -= dt;
      theta = 0.0;
      continue;
    }
    let c1 = L.z + g * dzLayer;
    let sinT2 = p * c1;
    if (sinT2 >= 1.0 || sinT2 <= -1.0) {
      okFlag = 2.0; // 折射翻转
      break;
    }
    let th1 = theta;
    let th2 = asin(clamp(sinT2, -1.0, 1.0));
    let tFull = log(tan(th2 * 0.5) / tan(th1 * 0.5)) / g;
    let dt = min(max(tFull, 0.0), tLeft);
    var thEnd = th2;
    if (dt < tFull) {
      thEnd = 2.0 * atan(tan(th1 * 0.5) * exp(g * dt));
    }
    x += (cos(th1) - cos(thEnd)) / (p * g);
    z += (sin(thEnd) - sin(th1)) / (p * g);
    tLeft -= dt;
    theta = thEnd;
  }
  if (okFlag != 1.0) {
    outBuf[outBase] = vec4f(0.0);
    outBuf[outBase + 1u] = vec4f(0.0, 2.0, 0.0, 0.0);
    return;
  }
  // 杆臂与图深
  let leverNav = mAtt * vec3f(params.lever.x, params.lever.y, params.lever.z);
  let e = p0.x + leverNav.y + x * sin(azimuth);
  let n = p0.y + leverNav.x + x * cos(azimuth);
  // 图深 = 射线深度 + 吃水 - 升沉 - 潮位（吃水定义到换能器，杆臂只影响水平位置）
  let depth = z + params.lever.w - p1.y - p1.z;
  let sigRoll = params.sigmas.z * D2R;
  let sigma = sqrt(
    params.sigmas.x * params.sigmas.x +
    params.sigmas.y * params.sigmas.y +
    params.sigmas.w * params.sigmas.w +
    x * sigRoll * x * sigRoll
  );
  outBuf[outBase] = vec4f(e, n, depth, x * sign(beta));
  outBuf[outBase + 1u] = vec4f(sigma, 0.0, 0.0, 0.0);
}
`
