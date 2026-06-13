import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import { getApiBaseUrl } from "./lib/api-base";
import App from "./App";
import "./index.css";

// Configure the generated API client to use a custom API base URL if set
const baseUrl = getApiBaseUrl();
if (baseUrl) {
  setBaseUrl(baseUrl);
}

document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);
