import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { applyBrandToDocument, loadBrandFromServer } from "./utils/brand";

applyBrandToDocument();

// Fetch the saved logo / colours / currency from the server. The last saved
// copy (localStorage) is already applied above, so the page never waits more
// than a moment for this.
const brandReady = Promise.race([
  loadBrandFromServer(),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]);

brandReady.then(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
