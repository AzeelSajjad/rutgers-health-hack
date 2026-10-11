import { createRoot } from "react-dom/client";
import { AuthApp } from "./auth/AuthApp";
import "./experience/styles.css";

createRoot(document.getElementById("root")!).render(<AuthApp />);
