// src/components/login/index.jsx
import BrandLogo from "../common/BrandLogo";
import { useBrand } from "../../contexts/BrandContext";
import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Lock, Mail, User, Eye, EyeOff, Phone } from "lucide-react";
import api from "../../utils/api";
import InputField from "../common/InputField";
import Button from "../common/Button";
import { showToast } from "../../utils/toast";

const Login = () => {
  const brand = useBrand();
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [adminExists, setAdminExists] = useState(true);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    contactNumber: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get("/api/auth/admin-exists")
      .then(({ data }) => {
        if (!mounted) return;
        setAdminExists(Boolean(data?.exists));
      })
      .catch(() => {
        // If the check fails, default to hiding sign-up (safer than
        // leaving it open) rather than blocking the login form itself.
        if (mounted) setAdminExists(true);
      })
      .finally(() => {
        if (mounted) setCheckingAdmin(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (adminExists && isSignUp) setIsSignUp(false);
  }, [adminExists, isSignUp]);

  const validate = () => {
    const next = {};

    if (isSignUp) {
      if (!form.firstName) next.firstName = "First name is required";
      if (!form.lastName) next.lastName = "Last name is required";
      if (!form.contactNumber) next.contactNumber = "Contact number is required";
      else if (!/^[0-9]{10,15}$/.test(form.contactNumber.replace(/[\s\-()]/g, ''))) {
        next.contactNumber = "Please enter a valid phone number";
      }
    }
    
    if (isSignUp) {
      if (!form.email) next.email = "Email is required";
      else if (!/\S+@\S+\.\S+/.test(form.email)) next.email = "Email is invalid";
    } else if (!form.email.trim()) {
      // Login accepts an e-mail OR a Staff ID (e.g. ZS0019).
      next.email = "Email or Staff ID is required";
    } else if (form.email.includes("@") && !/\S+@\S+\.\S+/.test(form.email)) {
      next.email = "Email is invalid";
    }
    
    if (!form.password) next.password = "Password is required";
    else if (form.password.length < 6)
      next.password = "Password must be at least 6 characters";
      
    if (isSignUp && form.password !== form.confirmPassword) {
      next.confirmPassword = "Passwords do not match";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleChange = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

const handleSubmit = async (e) => {
    e.preventDefault();
    

    if (!validate()) {
  
      return;
    }
    

    setLoading(true);
    try {
      if (isSignUp) {

        await api.post("/api/auth/register", {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          contactNumber: form.contactNumber,
          password: form.password,
        });
        

        showToast("success", "Account created successfully! Please login.");
        setIsSignUp(false);
        setForm({ 
          firstName: "", 
          lastName: "", 
          email: "", 
          contactNumber: "",
          password: "", 
          confirmPassword: "" 
        });
      } else {
        const { data } = await api.post("/api/auth/login", {
          email: form.email.trim(),
          password: form.password,
        });
      

        // Backend responds with { success, message, data: { id, name, email, role, token } }
        const payload = data.data || data;
        

        const { token, ...userInfo } = payload;
        

        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(userInfo));
        window.dispatchEvent(new Event("userLoggedIn"));
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "token",
            newValue: token,
            oldValue: null,
            storageArea: localStorage,
          })
        );

        // Left over from the old multi-company version.
        localStorage.removeItem("selectedCompany");
        showToast("success", "Logged in successfully");
        navigate("/", { replace: true });
      }
    } catch (error) {
      console.error("Auth request failed. Full error object:", error);
      console.error("error.message:", error.message);
      console.error("error.response?.status:", error.response?.status);
      console.error("error.response?.data:", error.response?.data);
      console.error("error.response?.headers:", error.response?.headers);
      console.error("error.request (if no response received):", error.request);
      console.error("error.config?.url:", error.config?.url);
      console.error("error.config?.baseURL:", error.config?.baseURL);

      showToast(
        "error",
        error.response?.data?.message || "Authentication failed"
      );
      if (isSignUp && error.response?.status === 403) {
        setAdminExists(true);
        setIsSignUp(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setForm({ 
      firstName: "", 
      lastName: "", 
      email: "", 
      contactNumber: "",
      password: "", 
      confirmPassword: "" 
    });
    setErrors({});
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Left side with Brand/Image - Black background */}
      <div
        className="hidden lg:flex lg:w-1/2 items-center justify-center p-8"
        style={{ background: `linear-gradient(135deg, ${brand.sidebarColor}, #000000)` }}
      >
        <div className="text-center max-w-md">
          {/* Smaller rounded logo with border */}
          <div className="mx-auto mb-4 flex justify-center">
            <BrandLogo
              className="max-h-40 w-auto object-contain"
              badgeClassName="h-20 w-20 text-4xl"
            />
          </div>
          <h1 className="text-white text-3xl font-bold">{brand.loginTitle}</h1>
          <p className="text-gray-400 mt-2 text-sm">{brand.tagline}</p>

          <div className="mt-8 text-sm text-gray-500 border-t border-gray-800 pt-6">
            <p>{brand.loginSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Right side with Login Form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 lg:py-0">
        <div className="w-full max-w-sm sm:max-w-md relative">
          {/* Card with shadow - shadow on top only */}
          <div className="bg-white rounded-2xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.3)] px-6 sm:px-8 pb-8 pt-12 mt-8">
            {/* Logo at the top - overlapping the card */}
            <div className="absolute left-1/2 transform -translate-x-1/2 -top-6">
              <div className="overflow-hidden rounded-t-2xl bg-white px-3">
                <BrandLogo
                  className="h-14 w-auto object-contain"
                  badgeClassName="h-12 w-12 text-xl"
                />
              </div>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-1 text-center mt-4">
              {isSignUp ? "Create Account" : "Admin Login"}
            </h2>
            <p className="text-gray-500 text-xs sm:text-sm mb-6 text-center">
              {isSignUp
                ? "Fill in your details to get started"
                : "Enter your credentials to continue"}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name fields - only for sign up */}
              {isSignUp && (
                <>
                  <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-1">
                      <User size={14} /> First Name
                    </label>
                    <InputField
                      type="text"
                      value={form.firstName}
                      onChange={handleChange("firstName")}
                      placeholder="John"
                      error={errors.firstName}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-1">
                      <User size={14} /> Last Name
                    </label>
                    <InputField
                      type="text"
                      value={form.lastName}
                      onChange={handleChange("lastName")}
                      placeholder="Doe"
                      error={errors.lastName}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-1">
                      <Phone size={14} /> Contact Number
                    </label>
                    <InputField
                      type="tel"
                      value={form.contactNumber}
                      onChange={handleChange("contactNumber")}
                      placeholder="+1 234 567 8900"
                      error={errors.contactNumber}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-1">
                  <Mail size={14} /> {isSignUp ? "Email" : "Email or Staff ID"}
                </label>
                <InputField
                  type={isSignUp ? "email" : "text"}
                  value={form.email}
                  onChange={handleChange("email")}
                  placeholder={isSignUp ? "suraj.pal@zapwms.com" : "suraj.pal@zapwms.com or ZS0019"}
                  error={errors.email}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-1">
                  <Lock size={14} /> Password
                </label>
                <div className="relative">
                  <InputField
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={handleChange("password")}
                    placeholder="••••••••"
                    error={errors.password}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-red-500 text-xs mt-1">{errors.password}</p>
                )}
              </div>

              {/* Confirm Password - only for sign up */}
              {isSignUp && (
                <div>
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1 mb-1">
                    <Lock size={14} /> Confirm Password
                  </label>
                  <div className="relative">
                    <InputField
                      type={showConfirmPassword ? "text" : "password"}
                      value={form.confirmPassword}
                      onChange={handleChange("confirmPassword")}
                      placeholder="••••••••"
                      error={errors.confirmPassword}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              )}

              {/* Blue Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg font-medium transition-all duration-200 bg-[var(--brand-primary)] hover:brightness-90 text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed text-sm sm:text-base cursor-pointer"
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Loading...
                  </div>
                ) : isSignUp ? (
                  "Create Account"
                ) : (
                  "Sign in"
                )}
              </button>

              {/* Security notice */}
              <div className="text-center text-xs text-gray-400 border-t border-gray-200 pt-4 mt-2">
                <p>
                  Access is limited to authorised personnel and is logged for
                  security.
                </p>
              </div>

              {/* Toggle between login and signup — sign-up is only ever
                  offered to bootstrap the first admin account. */}
              {!checkingAdmin && !adminExists && (
                <div className="text-center text-sm text-gray-600 pt-2">
                  {isSignUp ? (
                    <p>
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={toggleMode}
                        className="text-[var(--brand-primary)] hover:brightness-90 font-medium hover:underline"
                      >
                        Sign in
                      </button>
                    </p>
                  ) : (
                    <p>
                      Don't have an account?{" "}
                      <button
                        type="button"
                        onClick={toggleMode}
                        className="text-[var(--brand-primary)] hover:brightness-90 font-medium hover:underline"
                      >
                        Sign up
                      </button>
                    </p>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;