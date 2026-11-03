// controllers/settingsController.js
//
// Kept for the existing website / mobile app calls. The settings are now the
// CURRENT COMPANY's white-label profile (see controllers/companyController.js).
//   GET /api/settings  (public)  — branding + currency of the caller's company
//                                  (login token, X-Company-Id, ?company=slug,
//                                  or the site's custom domain)
//   PUT /api/settings            — same as PUT /api/company/profile
import { buildProfile } from "../services/companyProfile.js";
import { getRegisteredCompany } from "../utils/companyContext.js";
import { resolvePublicCompanyId, updateMyProfile } from "./companyController.js";

export const getSettings = async (req, res) => {
  try {
    const companyId = await resolvePublicCompanyId(req);
    const data = buildProfile(getRegisteredCompany(companyId), {
      baseUrl: `${req.protocol}://${req.get("host")}`,
    });
    // Registration numbers only for logged-in callers.
    if (!String(req.get("authorization") || "").startsWith("Bearer ")) {
      delete data.legalIds;
      delete data.legalIdList;
    }
    res.set("Cache-Control", "no-cache");
    res.set("Vary", "Authorization, X-Company-Id, Origin");
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, message: "Could not load settings" });
  }
};

export const updateSettings = updateMyProfile;
