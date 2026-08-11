
import mongoose from "mongoose";
import dotenv from "dotenv";
import { TAB_TREE } from "./config/permissions.js";

dotenv.config();

async function changeAdminToSuperAdmin() {
    console.log("\n========================================");
    console.log("STARTING SUPER-ADMIN UPDATE");
    console.log("========================================\n");

    try {
        // --------------------------------------------------
        // 1. Connect to MongoDB
        // --------------------------------------------------

        console.log("1. Connecting to MongoDB...");

        await mongoose.connect(process.env.MONGO_URI);

        console.log("2. MongoDB connected successfully");

        // --------------------------------------------------
        // 2. User ID
        // --------------------------------------------------

        const userId = new mongoose.Types.ObjectId(
            "6a61a04d929caf2bf9f6d9fc"
        );

        console.log("3. User ID:");
        console.log(userId);

        // --------------------------------------------------
        // 3. Get users collection directly
        // --------------------------------------------------

        console.log("4. Getting users collection...");

        const db = mongoose.connection.db;
        const usersCollection = db.collection("users");

        console.log("5. Users collection obtained");

        // --------------------------------------------------
        // 4. Find user before update
        // --------------------------------------------------

        console.log("6. Searching for user...");

        const userBefore = await usersCollection.findOne({
            _id: userId,
        });

        if (!userBefore) {
            console.log("7. User NOT FOUND");

            return;
        }

        console.log("7. User FOUND");

        console.log("\n========== USER BEFORE UPDATE ==========");

        console.log("ID:");
        console.log(userBefore._id);

        console.log("Name:");
        console.log(userBefore.name);

        console.log("First Name:");
        console.log(userBefore.firstName);

        console.log("Last Name:");
        console.log(userBefore.lastName);

        console.log("Email:");
        console.log(userBefore.email);

        console.log("Role:");
        console.log(userBefore.role);

        console.log("Permissions:");
        console.log(userBefore.permissions);

        console.log("========================================\n");

        // --------------------------------------------------
        // 5. Build ALL tab keys from TAB_TREE
        // --------------------------------------------------

        console.log("8. Loading TAB_TREE...");

        console.log("TAB_TREE:");
        console.log(TAB_TREE);

        const allTabKeys = TAB_TREE.flatMap((tab) => [
            tab.key,
            ...(tab.subTabs || []).map((subTab) => subTab.key),
        ]);

        console.log("9. All valid tab keys:");
        console.log(allTabKeys);

        console.log("10. Total tab/sub-tab permissions:");
        console.log(allTabKeys.length);

        // --------------------------------------------------
        // 6. Display every permission
        // --------------------------------------------------

        console.log("\n========== PERMISSIONS ==========");

        allTabKeys.forEach((tabKey, index) => {
            console.log(`${index + 1}. ${tabKey}`);
        });

        console.log("=================================\n");

        // --------------------------------------------------
        // 7. Prepare new permissions
        // --------------------------------------------------

        const newPermissions = {
            allTabs: true,
            tabs: allTabKeys,
        };

        console.log("11. New permissions object:");

        console.log(JSON.stringify(newPermissions, null, 2));

        // --------------------------------------------------
        // 8. Update role + permissions
        // --------------------------------------------------

        console.log("\n12. Updating user...");

        console.log("Changing role:");

        console.log({
            oldRole: userBefore.role,
            newRole: "super-admin",
        });

        console.log("Changing permissions:");

        console.log({
            oldPermissions: userBefore.permissions,
            newPermissions: newPermissions,
        });

        // IMPORTANT:
        // We replace the entire permissions field.
        //
        // This is necessary because the old database document
        // has:
        //
        // permissions: []
        //
        // while the schema expects:
        //
        // permissions: {
        //     allTabs: Boolean,
        //     tabs: []
        // }
        //
        // Therefore we do NOT use:
        //
        // "permissions.allTabs": true
        //
        // Instead we replace the complete permissions field.

        const result = await usersCollection.updateOne(
            {
                _id: userId,
            },
            {
                $set: {
                    role: "super-admin",

                    permissions: {
                        allTabs: true,
                        tabs: allTabKeys,
                    },

                    updatedAt: new Date(),
                },
            }
        );

        // --------------------------------------------------
        // 9. Show MongoDB result
        // --------------------------------------------------

        console.log("\n13. MongoDB update completed");

        console.log("Update result:");

        console.log({
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
        });

        // --------------------------------------------------
        // 10. Check whether update succeeded
        // --------------------------------------------------

        if (result.matchedCount === 0) {
            console.log("14. ERROR: User was not matched");

            return;
        }

        if (result.modifiedCount === 0) {
            console.log(
                "14. WARNING: User was found but nothing changed"
            );
        } else {
            console.log("14. User updated successfully");
        }

        // --------------------------------------------------
        // 11. Get user after update
        // --------------------------------------------------

        console.log("15. Reading user after update...");

        const userAfter = await usersCollection.findOne({
            _id: userId,
        });

        // --------------------------------------------------
        // 12. Display final user
        // --------------------------------------------------

        console.log("\n========== USER AFTER UPDATE ==========");

        console.log("ID:");
        console.log(userAfter._id);

        console.log("Name:");
        console.log(userAfter.name);

        console.log("Email:");
        console.log(userAfter.email);

        console.log("Role:");
        console.log(userAfter.role);

        console.log("Permissions:");
        console.log(userAfter.permissions);

        console.log("All Tabs:");
        console.log(userAfter.permissions?.allTabs);

        console.log("Tabs:");
        console.log(userAfter.permissions?.tabs);

        console.log("Number of tabs:");
        console.log(userAfter.permissions?.tabs?.length);

        console.log("=======================================\n");

        // --------------------------------------------------
        // 13. Verify role
        // --------------------------------------------------

        console.log("16. Verifying role...");

        if (userAfter.role === "super-admin") {
            console.log(
                "SUCCESS: Role is now super-admin"
            );
        } else {
            console.log(
                "ERROR: Role was not changed correctly"
            );
        }

        // --------------------------------------------------
        // 14. Verify allTabs
        // --------------------------------------------------

        console.log("17. Verifying allTabs...");

        if (userAfter.permissions?.allTabs === true) {
            console.log(
                "SUCCESS: allTabs = true"
            );
        } else {
            console.log(
                "ERROR: allTabs is not true"
            );
        }

        // --------------------------------------------------
        // 15. Verify every tab
        // --------------------------------------------------

        console.log("18. Verifying every tab...");

        const missingTabs = allTabKeys.filter(
            (tabKey) =>
                !userAfter.permissions?.tabs?.includes(tabKey)
        );

        if (missingTabs.length === 0) {
            console.log(
                "SUCCESS: User has every tab permission"
            );
        } else {
            console.log(
                "ERROR: Missing permissions:"
            );

            console.log(missingTabs);
        }

        // --------------------------------------------------
        // 16. Final result
        // --------------------------------------------------

        console.log("\n========================================");
        console.log("FINAL RESULT");
        console.log("========================================");

        console.log("User:");
        console.log(userAfter.name);

        console.log("Email:");
        console.log(userAfter.email);

        console.log("Role:");
        console.log(userAfter.role);

        console.log("allTabs:");
        console.log(userAfter.permissions?.allTabs);

        console.log("Total permissions:");
        console.log(userAfter.permissions?.tabs?.length);

        console.log("All permissions:");
        console.log(userAfter.permissions?.tabs);

        console.log("========================================");
        console.log("SUPER-ADMIN UPDATE COMPLETE");
        console.log("========================================\n");

    } catch (error) {
        console.error("\n========================================");
        console.error("ERROR");
        console.error("========================================");

        console.error("Error name:");
        console.error(error.name);

        console.error("Error message:");
        console.error(error.message);

        console.error("Full error:");
        console.error(error);

        console.error("========================================\n");

    } finally {
        console.log("Disconnecting MongoDB...");

        await mongoose.disconnect();

        console.log("MongoDB disconnected");
    }
}

changeAdminToSuperAdmin();

