import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "@/index.css";
import App from "@/App";

// Global axios defaults so a hung connection surfaces a clear timeout error
// to the UI (instead of leaving the user staring at a spinner indefinitely).
axios.defaults.timeout = 25000;

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
