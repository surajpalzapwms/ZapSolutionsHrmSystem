import { authenticate } from "../middleware/authenticate";

router.post("/login", async (req, res) => {
  consle.log("Login request received:", req.body); // Debugging log
  try {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username/email and password are required",
      });
    }

    // Normalize input
    username = username.trim().toLowerCase();
     
    // Find user by email OR name
    const user = await User.findOne({
      $or: [
        { email: username },
        { name: username }
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated.",
      });
    }

    const allowedRoles = ["admin", "super admin"];
    if (!allowedRoles.includes(user.role.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or SuperAdmin only.",
      });
    }

    // 🔥 IMPORTANT: Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      success: true,
      token,
      email: user.email,
      role: user.role,
      message: "Login successful",
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});
