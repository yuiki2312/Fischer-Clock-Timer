import React from "react";
import { createRoot } from "react-dom/client";
import FischerClockTimer from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FischerClockTimer />
  </React.StrictMode>,
);
