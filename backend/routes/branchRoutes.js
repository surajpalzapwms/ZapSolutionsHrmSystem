import express from "express";
import { protect, allowCompanyAdminOnly } from "../middleware/auth.js";
import {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  createBranchAdminInvite,
  cancelBranchAdminInvite,
  validateBranchIds,
} from "../controllers/branchController.js";

const router = express.Router();

// The company admin (or the super admin with a company open). A branch admin
// is refused by allowCompanyAdminOnly.
router.use(protect, allowCompanyAdminOnly);

router.get("/", listBranches);
router.post("/", createBranch);
router.put("/:id", validateBranchIds, updateBranch);
router.delete("/:id", validateBranchIds, deleteBranch);
router.post("/:id/admin-invites", validateBranchIds, createBranchAdminInvite);
router.delete("/:id/admin-invites/:inviteId", validateBranchIds, cancelBranchAdminInvite);

export default router;
