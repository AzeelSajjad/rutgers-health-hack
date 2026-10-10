import { createRoot } from "react-dom/client";
import { PatientLibrary } from "./library/PatientLibrary";
import { PracticePage } from "./practice/PracticePage";

createRoot(document.getElementById("root")!).render(location.pathname === "/practice" ? <PracticePage /> : <PatientLibrary />);
