import "./ui/style.css"
import { mountApp } from "./ui/app"
import { restoreSession } from "./ui/state"

const boot = async (): Promise<void> => {
  await restoreSession()
  mountApp(document.getElementById("app")!)
}

void boot()
