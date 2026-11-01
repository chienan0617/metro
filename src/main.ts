import "./styles/main.css";
import { App } from "./ui/app.ts";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("找不到 #app 容器");
}

void new App(root).start();
