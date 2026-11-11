const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");


const User = require("./models/User");
const Transaction = require("./models/Transaction");
const Order = require("./models/Order");
const ServicePrice = require("./models/ServicePrice");
const AdminLog = require("./models/AdminLog");
const Coupon = require("./models/Coupon");
const Announcement = require("./models/Announcement");
const Withdrawal = require("./models/Withdrawal");
const SupportConversation = require("./models/SupportConversation");
const legacyServiceSchema = new mongoose.Schema({
  name:String, platform:String, description:String, pricePer1000:Number,
  provider:String, providerServiceId:Number, providerPricePer1000:Number,
  boostType:String, min:Number, max:Number, active:Boolean
},{strict:false,collection:"services"});
const LegacyService = mongoose.models.LegacyService || mongoose.model("LegacyService",legacyServiceSchema,"services");
async function migrateLegacyPKServices(){
  try{
    const legacy=await LegacyService.find({providerServiceId:{$exists:true,$ne:null}}).lean();
    for(const item of legacy){
      const serviceId=String(item.providerServiceId);
      await ServicePrice.updateOne({serviceId},{$setOnInsert:{
        serviceId,name:item.name||"",category:item.platform||"",providerRate:Number(item.providerPricePer1000||0),
        sellingRate:Number(item.pricePer1000)>0?Number(item.pricePer1000):Number(item.providerPricePer1000||0)*1.6835,enabled:item.active!==false,displayName:item.name||"",
        description:item.description||"",minOverride:Number(item.min||0)||null,maxOverride:Number(item.max||0)||null,updatedBy:"legacy-pk-migration"
      }},{upsert:true});
    }
    if(legacy.length)console.log(`Migrated ${legacy.length} existing PK service pricing records.`);
  }catch(error){console.warn("Legacy service migration skipped:",error.message);}
}
const fs = require("fs");
const path = require("path");
const protect = require("./middleware/authMiddleware");
const adminProtect = require("./middleware/adminMiddleware");
const axios = require("axios");

dotenv.config();

const resend = { emails: { async send(payload) {
  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  if(!apiKey)return {error:new Error("RESEND_API_KEY is not configured.")};
  try { const {replyTo,...emailPayload}=payload;const response=await axios.post("https://api.resend.com/emails",{...emailPayload,from:process.env.RESEND_FROM||payload.from,reply_to:process.env.RESEND_REPLY_TO||replyTo||undefined},{timeout:12000,headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"}});return {data:response.data,error:null};}
  catch(error){return {data:null,error:error.response?.data||error};}
}}};
async function sendSignupWelcomeEmail(user){
 const safe=String(user.fullName||"there").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const {error}=await resend.emails.send({from:process.env.RESEND_FROM||"PK-BOOSTER <welcome@pk-booster.com>",to:[user.email],subject:"Welcome to PK-BOOSTER",html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;background:#f8f5fc;color:#241b2d"><div style="background:white;border-radius:16px;padding:28px"><h2 style="color:#7C3AED">PK-BOOSTER</h2><h1>Welcome, ${safe}!</h1><p>Your account has been created successfully. You can now fund your wallet and place social media boost orders.</p><p>Thanks for joining PK-BOOSTER.</p></div></div>`});
 if(error)console.error("Signup welcome email failed:",error);return !error;
}


// Only the TikTok services selected by the site owner should be offered to customers.
// Provider names and rates remain sourced from Owlet.
const ALLOWED_TIKTOK_FOLLOWER_SERVICE_IDS = new Set(["8288", "23425"]);
const ALLOWED_TIKTOK_LIKE_SERVICE_IDS = new Set(["21632"]);
const ALLOWED_TIKTOK_VIEW_SERVICE_IDS = new Set(["23148", "20884"]);
function getTikTokServiceText(service) {
  return `${service?.name || ""} ${service?.category || ""}`.toLowerCase();
}
function isTikTokFollowersService(service) {
  const text = getTikTokServiceText(service);
  return text.includes("tiktok") && text.includes("follower");
}
function isTikTokLikesService(service) {
  const text = getTikTokServiceText(service);
  return text.includes("tiktok") && text.includes("like");
}
function isTikTokViewsService(service) {
  const text = getTikTokServiceText(service);
  return text.includes("tiktok") && text.includes("view");
}
function shouldExposeService(service) {
  const id=String(service?.service||"");
  if(["8288","23425","21632","23148","20884"].includes(id))return true;
  const text=`${service?.name||""} ${service?.category||""}`.toLowerCase();
  return !text.includes("tiktok");
}

// Cache the large Owlet service catalogue briefly so every new page/login does not
// trigger another slow request for thousands of services.
let owletServicesCache = null;
let owletServicesCacheAt = 0;
let owletServicesRequestInFlight = null;
const OWLET_SERVICES_CACHE_TTL_MS = 5 * 60 * 1000;
async function getOwletServicesCached() {
  if (Array.isArray(owletServicesCache) && Date.now() - owletServicesCacheAt < OWLET_SERVICES_CACHE_TTL_MS) {
    return owletServicesCache;
  }
  if (owletServicesRequestInFlight) return owletServicesRequestInFlight;
  owletServicesRequestInFlight = (async () => {
    const response = await axios.post(
      process.env.OWLET_API_URL,
      { key: process.env.OWLET_API_KEY, action: "services" },
      { headers: { "Content-Type": "application/json" }, timeout: 12000 }
    );
    if (!Array.isArray(response.data)) throw new Error("Owlet returned an invalid services list");
    owletServicesCache = response.data;
    owletServicesCacheAt = Date.now();
    return owletServicesCache;
  })();
  try { return await owletServicesRequestInFlight; }
  finally { owletServicesRequestInFlight = null; }
}

// Idempotent wallet refund: the unique transaction reference prevents a repeated
// status poll from crediting the same order more than once.
async function refundOrderOnce(order, referencePrefix = "REFUND") {
  if (order.refundProcessed) return false;
  const user = await User.findById(order.userId || order.user);
  if (!user) throw new Error(`Cannot refund order ${order._id}: user not found`);
  const txRef = `${referencePrefix}-${order._id}`;
  try {
    await Transaction.create({
      userId: user._id,
      txRef,
      type: "refund",
      amount: Number(order.amount || 0),
      currency: "NGN",
      status: "successful"
    });
  } catch (error) {
    if (error.code === 11000) {
      // The refund transaction already exists; do not credit the wallet again.
      order.refundProcessed = true;
      return false;
    }
    throw error;
  }
  await User.updateOne({ _id: user._id }, { $inc: { balance: Number(order.amount || 0) } });
  order.refundProcessed = true;
  return true;
}
async function sendOrderStatusEmail(order, notificationStatus) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY is not configured; order ${notificationStatus} email skipped.`);
    return false;
  }
  if (!order || (Array.isArray(order.emailNotifications) && order.emailNotifications.includes(notificationStatus))) {
    return false;
  }

  const user = await User.findById(order.userId || order.user).select("fullName email");
  if (!user?.email) {
    console.warn(`Cannot send order ${notificationStatus} email: customer email not found.`);
    return false;
  }

  const details = {
    placed: {
      subject: "Your PK-BOOSTER order has been placed successfully",
      heading: "Your order has been placed successfully!",
      message: "We have received your order and sent it to our service provider. You can check its progress from your PK-BOOSTER dashboard."
    },
    completed: {
      subject: "Your PK-BOOSTER order was completed successfully",
      heading: "Your order was completed successfully!",
      message: "Good news! Your order has been marked as completed. Thank you for using PK-BOOSTER."
    },
    cancelled: {
      subject: "Your PK-BOOSTER order was cancelled",
      heading: "Your order has been cancelled",
      message: "Your order has been cancelled. If a refund was processed, the amount has been returned to your PK-BOOSTER wallet."
    },
    refunded: {
      subject: "Your PK-BOOSTER order has been refunded",
      heading: "Your order has been refunded",
      message: "Your order has been refunded and the amount has been returned to your PK-BOOSTER wallet."
    }
  }[notificationStatus];
  if (!details) return false;

  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const orderId = safe(order._id);
  const amount = Number(order.amount || 0).toLocaleString("en-NG");
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "PK-BOOSTER <welcome@pk-booster.com>",
    replyTo: "support@pk-booster.com",
    to: [user.email],
    subject: details.subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;background:#f6f8fa;color:#172033;">
        <div style="background:#fff;border:1px solid #eaecf0;border-radius:16px;padding:28px;">
          <div style="font-size:24px;font-weight:800;color:#7C3AED;">PK-<span style="color:#A855F7;">Boost</span></div>
          <h2 style="color:#7C3AED;margin-top:28px;">${details.heading}</h2>
          <p style="font-size:15px;line-height:1.7;color:#475467;">Hi ${safe(user.fullName || "there")}, ${details.message}</p>
          <div style="padding:16px;background:#f8fafc;border:1px solid #eaecf0;border-radius:12px;line-height:1.9;">
            <strong>Order ID:</strong> ${orderId}<br>
            <strong>Service:</strong> ${safe(order.serviceName)}<br>
            <strong>Quantity:</strong> ${Number(order.quantity || 0).toLocaleString()}<br>
            <strong>Amount:</strong> ₦${amount}<br>
            <strong>Status:</strong> ${safe(notificationStatus)}
          </div>
          <p style="font-size:14px;color:#475467;margin-top:24px;">If you have questions, reply to this email or contact PK-BOOSTER Support.</p>
          <p style="font-size:14px;color:#475467;">— PK-BOOSTER Support</p>
        </div>
      </div>`
  });
  if (error) throw error;

  order.emailNotifications = [...(order.emailNotifications || []), notificationStatus];
  await order.save();
  console.log(`Order ${notificationStatus} email sent:`, data?.id || "ok");
  return true;
}

async function sendWelcomeBackEmail(user) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not configured; welcome email skipped.");
    return;
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "PK-BOOSTER <welcome@pk-booster.com>",
    replyTo: "support@pk-booster.com",
    to: [user.email],
    subject: "Welcome back to PK-BOOSTER",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f6f8fa;color:#172033;">
        <div style="background:#ffffff;border-radius:18px;padding:30px;border:1px solid #eaecf0;">
          <div style="font-size:24px;font-weight:800;color:#7C3AED;margin-bottom:6px;">PK-<span style="color:#A855F7;">Boost</span></div>
          <p style="font-size:14px;color:#667085;margin-top:0;">Social Growth</p>
          <h2 style="font-size:24px;margin:28px 0 10px;color:#101828;">Welcome back, ${String(user.fullName || "there").replace(/[<>]/g, "")}!</h2>
          <p style="font-size:15px;line-height:1.7;color:#475467;">
            You have successfully signed in to your PK-BOOSTER account. Your wallet, orders and boosting services are ready for you.
          </p>
          <div style="margin:26px 0;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #eaecf0;">
            <strong style="color:#7C3AED;">Account email:</strong> ${String(user.email).replace(/[<>]/g, "")}
          </div>
          <p style="font-size:13px;line-height:1.6;color:#98a2b3;">If this sign-in was not you, please change your password and contact PK-BOOSTER Support.</p>
          <p style="font-size:14px;color:#475467;margin-top:28px;">— PK-BOOSTER Support</p>
        </div>
      </div>
    `
  });

  if (error) {
    throw error;
  }

  console.log("Welcome-back email sent:", data?.id || "ok");
}

axios.defaults.timeout=12000;

const app = express();

app.use(cors());

app.use(express.json());

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    migrateLegacyPKServices().finally(() => getOwletServicesCached().catch(error => console.warn("Initial Owlet catalogue warm-up skipped:",error.message)));
  })
  .catch((error) => {
    console.error("MongoDB connection failed:");
    console.error(error.message);
  });

app.get("/", (req, res) => {

  res.json({
    message: "PK-BOOSTER server is running"
  });

});

app.post(["/api/auth/register","/register"], async (req, res) => {

  try {

    const {
      fullName,
      email,
      password
    } = req.body;

    if (!fullName || !email || !password) {

      return res.status(400).json({
        success: false,
        message: "Full name, email and password are required."
      });

    }

    if (password.length < 8) {

      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters."
      });

    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const existingUser =
      await User.findOne({
        email: normalizedEmail
      });


    if (existingUser) {

      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });

    }

    const hashedPassword =
      await bcrypt.hash(password, 12);

    const user = await User.create({

      fullName: fullName.trim(),

      email: normalizedEmail,

      password: hashedPassword,

      balance: 0

    });
    sendSignupWelcomeEmail(user).catch(emailError => console.error("Signup email error:", emailError.message));

    res.status(201).json({

      success: true,

      message: "Account created successfully.",

      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        balance: user.balance
      }

    });


  } catch (error) {

    console.error("Registration error:", error);

    res.status(500).json({

      success: false,

      message: "Something went wrong while creating your account."

    });

  }

});

const jwt = require("jsonwebtoken");

app.post(["/api/auth/login","/login"], async (req, res) => {

  try {

    const { email, password } = req.body;

    if (!email || !password) {

      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });

    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail
    });


    if (!user) {

      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });

    }

    if (user.active === false) {
      return res.status(403).json({ success: false, message: "This account is suspended." });
    }

    const passwordMatch =
      await bcrypt.compare(password, user.password);


    if (!passwordMatch) {

      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });

    }

    const token = jwt.sign(
      {
        userId: user._id
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );
    sendWelcomeBackEmail(user).catch(emailError => console.error("Welcome-back email error:", emailError.message || emailError));

    res.json({

      success: true,

      message: "Login successful.",

      token,

      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        balance: user.balance,
        role: user.role || "user"
      }

    });


  } catch (error) {

    console.error("Login error:", error);

    res.status(500).json({

      success: false,

      message: "Something went wrong while logging in."

    });

  }

});
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail
    });
    if (!user) {
      return res.json({
        message: "If an account exists with that email, a reset link has been sent."
      });
    }
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);

    await user.save();
const resetLink =
  `${process.env.FRONTEND_URL || "https://pk-booster.com"}/reset-password.html?token=${rawToken}`;
const { data, error } = await resend.emails.send({
  from: process.env.RESEND_FROM || "PK-BOOSTER <welcome@pk-booster.com>",
  replyTo: "support@pk-booster.com",
  to: [normalizedEmail],
  subject: "Reset Your PK-BOOSTER Password",
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 30px;">
      
      <h2 style="color: #A855F7;">
        PK-BOOSTER
      </h2>

      <p>Hello,</p>

      <p>
        We received a request to reset your PK-BOOSTER password.
      </p>

      <p>
        Click the button below to create a new password:
      </p>

      <div style="margin: 30px 0;">
        <a
          href="${resetLink}"
          style="
            display: inline-block;
            background: #A855F7;
            color: white;
            text-decoration: none;
            padding: 14px 24px;
            border-radius: 8px;
            font-weight: bold;
          "
        >
          Reset Password
        </a>
      </div>

      <p>
        This link will expire in <strong>30 minutes</strong>.
      </p>

      <p>
        If you did not request a password reset, you can safely ignore this email.
      </p>

      <p>
        — PK-BOOSTER Support
      </p>

    </div>
  `
});

if (error) {
  console.error("Resend email error:", error);

  return res.status(500).json({
    message: "Unable to send reset email. Please try again later."
  });
}

console.log("Password reset email sent:", data.id);

return res.json({
  message: "If an account exists with that email, a reset link has been sent."
});

} catch (error) {
  console.error("Forgot password error:", error);

  res.status(500).json({
    message: "Something went wrong. Please try again."
  });
}
});
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Reset token and password are required."
      });
    }
    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters."
      });
    }

    if (!/[A-Za-z]/.test(password)) {
      return res.status(400).json({
        message: "Password must contain at least one letter."
      });
    }

    if (!/[0-9]/.test(password)) {
      return res.status(400).json({
        message: "Password must contain at least one number."
      });
    }
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: {
        $gt: new Date()
      }
    });

    if (!user) {
      return res.status(400).json({
        message: "Reset link is invalid or has expired."
      });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    return res.json({
      message: "Password reset successfully."
    });

  } catch (error) {
    console.error("Reset password error:", error);

    res.status(500).json({
      message: "Something went wrong. Please try again."
    });
  }
});

function authenticateToken(req, res, next) {

  const authHeader = req.headers.authorization;

  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

  if (!token) {

    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });

  }

  jwt.verify(
    token,
    process.env.JWT_SECRET,
    (error, decoded) => {

      if (error) {

        return res.status(403).json({
          success: false,
          message: "Invalid or expired token."
        });

      }

      req.userId = decoded.userId || decoded.id;

      next();

    }
  );

}
app.get(
  ["/api/auth/me","/me"],
  authenticateToken,
  async (req, res) => {
    try {

      const user =
        await User.findById(req.userId)
          .select("-password");


      if (!user) {

        return res.status(404).json({

          success: false,

          message: "User not found."

        });

      }


      res.json({

        success: true,

        user: {

          id: user._id,

          fullName: user.fullName,

          email: user.email,

          balance: user.balance

        }

      });


    } catch (error) {

      console.error(
        "Get current user error:",
        error
      );


      res.status(500).json({

        success: false,

        message: "Server error."

      });

    }

  }
);


app.get("/get-user", protect, async (req, res) => {

  try {

    const user = await User.findById(req.userId)
      .select("-password");

    if (!user) {

      return res.status(404).json({
        success: false,
        message: "User not found"
      });

    }

    res.json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        balance: user.balance
      }
    });

  } catch (error) {

    console.error("Get user error:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });

  }

});

app.post(
  "/api/wallet/fund",
  protect,
  async (req, res) => {

    try {

      const { amount } = req.body;

      const paymentAmount = Number(amount);

      if (!paymentAmount || paymentAmount < 100) {

        return res.status(400).json({
          success: false,
          message: "Minimum funding amount is ₦100."
        });

      }

      const user = await User.findById(req.userId);

      if (!user) {

        return res.status(404).json({
          success: false,
          message: "User not found."
        });

      }

      const txRef =
        `OGBOOST-${Date.now()}-${user._id}`;

      await Transaction.create({

        userId: user._id,

        txRef: txRef,

        type: "deposit",

        amount: paymentAmount,

        currency: "NGN",

        status: "pending"

      });

      const response = await axios.post(

        "https://api.flutterwave.com/v3/payments",

        {

          tx_ref: txRef,

          amount: paymentAmount,

          currency: "NGN",

          redirect_url:
            `${process.env.FRONTEND_URL}/payment-success.html`,

          customer: {

            email: user.email,

            name: user.fullName

          },

          customizations: {

            title: "PK-BOOSTER Wallet",

            description:
              "Fund your PK-BOOSTER wallet"

          },

          meta: {

            userId:
              user._id.toString(),

            txRef: txRef

          }

        },

        {

          headers: {

            Authorization:
              `Bearer ${process.env.FLW_SECRET_KEY}`,

            "Content-Type":
              "application/json"

          }

        }

      );


      res.json({

        success: true,

        paymentLink:
          response.data.data.link,

        txRef: txRef

      });


    } catch (error) {

      console.error(

        "Flutterwave payment error:",

        error.response?.data ||
        error.message

      );


      res.status(500).json({

        success: false,

        message:
          "Unable to initialize payment."

      });

    }

  }
);

app.get(
  "/api/wallet/verify",
  async (req, res) => {

    try {

      const {
        transaction_id,
        tx_ref
      } = req.query;


      if (!transaction_id || !tx_ref) {

        return res.status(400).json({

          success: false,

          message:
            "Missing transaction information."

        });

      }

      // Flutterwave redirects back without the user's JWT. The unique tx_ref
      // identifies the pending deposit; the server still verifies it with Flutterwave.
      const transaction =
        await Transaction.findOne({
          txRef: tx_ref
        });


      if (!transaction) {

        return res.status(404).json({

          success: false,

          message:
            "Transaction not found."

        });

      }

      if (
        transaction.status ===
        "successful"
      ) {
        // Return the original deposit amount for repeat verification too.
        // This keeps the success page from treating an already-credited payment
        // as an incomplete response.
        const creditedUser = await User.findById(transaction.userId).select("balance");
        return res.json({
          success: true,
          message: "Payment already processed.",
          amount: Number(transaction.amount || 0),
          balance: Number(creditedUser?.balance || 0)
        });
      }

      const response =
        await axios.get(

          `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,

          {

            headers: {

              Authorization:
                `Bearer ${process.env.FLW_SECRET_KEY}`,

              "Content-Type":
                "application/json"

            }

          }

        );


      const payment =
        response.data.data;

      if (

        payment.status !==
        "successful"

        ||

        payment.currency !==
        "NGN"

        ||

        payment.tx_ref !==
        transaction.txRef

        ||

        Number(payment.amount) <
        Number(transaction.amount)

      ) {

        transaction.status =
          "failed";

        await transaction.save();


        return res.status(400).json({

          success: false,

          message:
            "Payment verification failed."

        });

      }

      const user =
        await User.findById(
          transaction.userId
        );


      if (!user) {

        return res.status(404).json({

          success: false,

          message:
            "User not found."

        });

      }

      user.balance =
        Number(user.balance || 0) +
        Number(transaction.amount);


      await user.save();

      transaction.status =
        "successful";

      transaction.flutterwaveId =
        String(payment.id);

      await transaction.save();

      res.json({

        success: true,

        message:
          "Wallet funded successfully.",

        balance:
          user.balance,

        amount:
          transaction.amount

      });


    } catch (error) {

      console.error(

        "Payment verification error:",

        error.response?.data ||
        error.message

      );


      res.status(500).json({

        success: false,

        message:
          "Unable to verify payment."

      });

    }

  }
);

app.get(
  "/api/wallet/transactions",
  protect,
  async (req, res) => {

    try {

      const transactions = await Transaction.find({
        $or: [{userId:req.userId},{user:req.userId}]
      })
        .sort({ createdAt: -1 })
        .limit(50);

      res.json({
        success: true,
        transactions
      });

    } catch (error) {

      console.error(
        "Transaction history error:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Unable to load transactions."
      });

    }

  }
);

app.get(
  "/api/wallet/summary",
  protect,
  async (req, res) => {

    try {

      const transactions = await Transaction.find({
        $or: [{userId:req.userId},{user:req.userId}]
      });

      let totalDeposited = 0;
      let totalSpent = 0;

      transactions.forEach(transaction => {

        if (
          transaction.status === "successful"
        ) {

          if (
            transaction.type === "deposit"
          ) {

            totalDeposited +=
              Number(transaction.amount || 0);

          }

          if (
            transaction.type === "order" ||
            transaction.type === "purchase"
          ) {

            totalSpent +=
              Number(transaction.amount || 0);

          }

        }

      });

      res.json({

        success: true,

        summary: {

          totalDeposited,
          totalSpent,
          transactionCount:
            transactions.length

        }

      });

    } catch (error) {

      console.error(
        "Wallet summary error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "Unable to load wallet summary."

      });

    }

  }
);

app.get("/api/owlet/services", async (req, res) => {

  try {

    const response = await axios.post(
      process.env.OWLET_API_URL,
      {
        key: process.env.OWLET_API_KEY,
        action: "services"
      },
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    console.log("OWLET SERVICES:", response.data);

    res.json({
      success: true,
      services: response.data
    });

  } catch (error) {

    console.error(
      "Owlet API error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message: "Unable to connect to Owlet.",
      error: error.response?.data || error.message
    });

  }

});

app.get("/api/services",async(req,res)=>{
 try{
  const catalog=await getOwletServicesCached(),overrides=await ServicePrice.find({}).lean(),map=new Map(overrides.map(x=>[String(x.serviceId),x]));
  const services=catalog.filter(shouldExposeService).map(x=>{
   const id=String(x.service),saved=map.get(id),rate=Number(x.rate||0);if(saved?.enabled===false)return null;
   const price=saved&&Number(saved.sellingRate)>0?Number(saved.sellingRate):rate*1.6835,tiktok=["8288","23425","21632","23148","20884"].includes(id),text=`${x.name||""} ${x.category||""}`.toLowerCase();
   const platform=tiktok?"TikTok":/instagram/.test(text)?"Instagram":/facebook/.test(text)?"Facebook":/youtube/.test(text)?"YouTube":/telegram/.test(text)?"Telegram":/whatsapp/.test(text)?"WhatsApp":(x.category||"Other");
   const boostType=id==="21632"?"Likes":["23148","20884"].includes(id)?"Views":["8288","23425"].includes(id)?"Followers":(x.type||x.category||"Other");
   return {service:id,serviceId:id,providerServiceId:id,name:saved?.displayName||x.name,type:boostType,boostType,category:saved?.category||x.category,platform,price,pricePer1000:price,min:id==="8288"?50:id==="23425"?200:(saved?.minOverride??x.min),max:saved?.maxOverride??x.max};
  }).filter(Boolean);
  res.json({success:true,services});
 }catch(e){res.status(502).json({success:false,message:"Unable to load services."});}
});

app.post(
  ["/api/orders", "/orders/owlet"],
  protect,
  async (req, res) => {
    let order = null;
    let walletDebited = false;
    let providerRequestStarted = false;

    try {
      const { serviceId: bodyServiceId, service, platform, link, quantity } = req.body || {};
      const serviceId = bodyServiceId || service;
      const selectedQuantity = Number(quantity);

      if (!serviceId || !link || !Number.isInteger(selectedQuantity) || selectedQuantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Service, link and a valid quantity are required."
        });
      }

      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const owletServices = await getOwletServicesCached();
      const selectedService = owletServices.find(
        item => String(item.service) === String(serviceId)
      );

      if (!selectedService) {
        return res.status(404).json({ success: false, message: "Selected service was not found. Please refresh services and try again." });
      }

      if (isTikTokFollowersService(selectedService) && !ALLOWED_TIKTOK_FOLLOWER_SERVICE_IDS.has(String(selectedService.service))) {
        return res.status(400).json({ success: false, message: "This TikTok Followers service is not enabled on PK-BOOSTER." });
      }
      if (isTikTokLikesService(selectedService) && !ALLOWED_TIKTOK_LIKE_SERVICE_IDS.has(String(selectedService.service))) {
        return res.status(400).json({ success: false, message: "This TikTok Likes service is not enabled on PK-BOOSTER." });
      }
      if (isTikTokViewsService(selectedService) && !ALLOWED_TIKTOK_VIEW_SERVICE_IDS.has(String(selectedService.service))) {
        return res.status(400).json({ success: false, message: "This TikTok Views service is not enabled on PK-BOOSTER." });
      }

      const savedPrice = await ServicePrice.findOne({
        serviceId: String(selectedService.service)
      }).lean();

      if (savedPrice && savedPrice.enabled === false) {
        return res.status(400).json({ success: false, message: "This service is currently unavailable." });
      }

      const minimum = Number(savedPrice?.minOverride ?? selectedService.min ?? 1);
      const maximum = Number(savedPrice?.maxOverride ?? selectedService.max ?? 999999999);

      if (selectedQuantity < minimum || selectedQuantity > maximum) {
        return res.status(400).json({
          success: false,
          message: `Quantity must be between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`
        });
      }

      const providerRate = Number(selectedService.rate || 0);
      const sellingRate = savedPrice
        ? Number(savedPrice.sellingRate)
        : providerRate + (providerRate * 68.35 / 100);

      if (!Number.isFinite(sellingRate) || sellingRate <= 0) {
        return res.status(400).json({
          success: false,
          message: "This service does not have a valid selling price yet. Please contact support."
        });
      }

      const totalPrice = Math.ceil((selectedQuantity / 1000) * sellingRate);
      if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
        return res.status(400).json({ success: false, message: "Unable to calculate the order price." });
      }

      // Create a local order record before contacting the provider. This gives every
      // wallet debit a permanent order reference for audit and recovery.
      order = await Order.create({
        userId: user._id,
        serviceId: String(selectedService.service),
        serviceName: selectedService.name || `Service ${serviceId}`,
        platform: platform || "",
        link: String(link).trim(),
        quantity: selectedQuantity,
        amount: totalPrice,
        providerCharge: providerRate * (selectedQuantity / 1000),
        status: "Pending",
        walletDeducted: false,
        providerSubmissionError: ""
      });

      // Atomic debit: concurrent requests cannot spend the same wallet funds.
      const debitedUser = await User.findOneAndUpdate(
        { _id: user._id, balance: { $gte: totalPrice } },
        { $inc: { balance: -totalPrice } },
        { new: true }
      );

      if (!debitedUser) {
        await Order.deleteOne({ _id: order._id });
        order = null;
        return res.status(400).json({
          success: false,
          message: "Insufficient wallet balance. Please refresh your wallet and try again."
        });
      }
      walletDebited = true;

      // Persist the debit ledger entry BEFORE submitting the provider order.
      // If the ledger cannot be written, restore the wallet and do not submit.
      try {
        await Transaction.create({
          userId: user._id,
          txRef: `ORDER-${order._id}`,
          type: "order",
          amount: totalPrice,
          currency: "NGN",
          status: "successful",
          balanceAfter: Number(debitedUser.balance || 0),
          note: `PK-BOOSTER order ${order._id}`
        });
      } catch (ledgerError) {
        await User.updateOne({ _id: user._id }, { $inc: { balance: totalPrice } });
        walletDebited = false;
        await Order.deleteOne({ _id: order._id });
        order = null;
        throw new Error(`Wallet transaction could not be recorded; no provider order was sent. ${ledgerError.message}`);
      }

      await Order.updateOne(
        { _id: order._id },
        { $set: { walletDeducted: true } }
      );

      // From this point onward, a network error is ambiguous: the provider may
      // have accepted the order even if our server did not receive its response.
      // Never auto-refund an ambiguous submission, as that can give away a free boost.
      providerRequestStarted = true;
      let owletResponse;
      try {
        owletResponse = await axios.post(
          process.env.OWLET_API_URL,
          {
            key: process.env.OWLET_API_KEY,
            action: "add",
            service: selectedService.service,
            link: String(link).trim(),
            quantity: selectedQuantity
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 25000
          }
        );
      } catch (providerError) {
        const providerBody = providerError.response?.data;
        const explicitReject = providerBody && !providerBody.order && (
          providerBody.error || providerBody.success === false
        );

        if (explicitReject) {
          await Order.updateOne(
            { _id: order._id },
            { $set: { status: "Failed", providerSubmissionError: String(providerBody.error || "Provider rejected the order.") } }
          );
          order.status = "Failed";
          order.walletDeducted = true;
          await refundOrderOnce(order, "ORDER-REFUND");
          const freshUser = await User.findById(user._id).select("balance");
          return res.status(400).json({
            success: false,
            refunded: true,
            message: providerBody.error || "Owlet rejected the order. Your wallet has been refunded.",
            balance: Number(freshUser?.balance || 0)
          });
        }

        await Order.updateOne(
          { _id: order._id },
          { $set: {
            status: "Pending",
            providerSubmissionError: "Provider response was not received. Check provider status before retrying."
          } }
        );
        const freshUser = await User.findById(user._id).select("balance");
        return res.status(202).json({
          success: true,
          pendingConfirmation: true,
          message: "Your wallet has been charged and your order is awaiting provider confirmation. Please do not submit it again.",
          order: {
            id: String(order._id),
            service: order.serviceName,
            link: order.link,
            quantity: order.quantity,
            amount: order.amount,
            status: "Pending"
          },
          balance: Number(freshUser?.balance || 0)
        });
      }

      const owletData = owletResponse?.data;
      console.log("OWLET ORDER RESPONSE:", owletData);

      if (!owletData || !owletData.order) {
        // A clear provider rejection is safe to refund. Keep the local order and
        // ledger history so the refund is auditable and cannot be repeated.
        await Order.updateOne(
          { _id: order._id },
          { $set: { status: "Failed", providerSubmissionError: String(owletData?.error || "Owlet rejected the order.") } }
        );
        order.status = "Failed";
        order.walletDeducted = true;
        await refundOrderOnce(order, "ORDER-REFUND");
        const freshUser = await User.findById(user._id).select("balance");
        return res.status(400).json({
          success: false,
          refunded: true,
          message: owletData?.error || "Owlet rejected the order. Your wallet has been refunded.",
          balance: Number(freshUser?.balance || 0)
        });
      }

      // Provider accepted. Update the existing order record; never roll back the
      // customer's debit if a later email or response operation fails.
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            providerOrderId: String(owletData.order),
            status: "processing",
            providerSubmissionError: ""
          }
        }
      );

      order.providerOrderId = String(owletData.order);
      order.status = "processing";

      sendOrderStatusEmail(order, "placed").catch(emailError =>
        console.error("Order placed email error:", emailError.message || emailError)
      );

      const freshUser = await User.findById(user._id).select("balance");
      return res.json({
        success: true,
        message: "Boost order placed successfully.",
        order: {
          id: String(order._id),
          providerOrderId: order.providerOrderId,
          service: order.serviceName,
          link: order.link,
          quantity: order.quantity,
          amount: order.amount,
          status: order.status
        },
        balance: Number(freshUser?.balance || 0)
      });

    } catch (error) {
      console.error("Create order error:", error.response?.data || error.message);

      // Only undo a debit when the provider request has NOT started. Once it has
      // started, its outcome may be unknown; an automatic refund could create a
      // free order if the provider actually accepted it.
      if (walletDebited && !providerRequestStarted && order) {
        try {
          await User.updateOne(
            { _id: order.userId },
            { $inc: { balance: Number(order.amount || 0) } }
          );
          await Transaction.updateOne(
            { txRef: `ORDER-${order._id}` },
            { $set: { status: "reversed", note: `Reversed before provider submission for order ${order._id}` } }
          );
          await Order.deleteOne({ _id: order._id });
        } catch (rollbackError) {
          console.error("Pre-provider wallet rollback failed:", rollbackError.message);
        }
      }

      if (providerRequestStarted && order) {
        try {
          await Order.updateOne(
            { _id: order._id },
            { $set: {
              status: "Pending",
              providerSubmissionError: "Provider submission started but the final response could not be saved. Manual confirmation required."
            } }
          );
          const currentUser = await User.findById(order.userId).select("balance");
          return res.status(202).json({
            success: true,
            pendingConfirmation: true,
            message: "Your wallet has been charged. The provider response is being checked; please do not place this order again.",
            order: {
              id: String(order._id),
              service: order.serviceName,
              quantity: order.quantity,
              amount: order.amount,
              status: "Pending"
            },
            balance: Number(currentUser?.balance || 0)
          });
        } catch (pendingSaveError) {
          console.error("Could not mark ambiguous order pending:", pendingSaveError.message);
        }
      }

      return res.status(500).json({
        success: false,
        message: "Unable to complete the order. If your wallet was charged, contact support before trying again."
      });
    }
  }
);

app.get(
  ["/api/orders","/orders"],
  protect,
  async (req,res)=>{
    try{
      const orders=await Order.find({$or:[{userId:req.userId},{user:req.userId}]}).sort({createdAt:-1}).lean();
      orders.forEach(order=>{
        order.id=String(order._id);
        order.service=order.serviceName||order.service||"Boost service";
        order.price=Number(order.amount||0);
        order.amount=Number(order.amount||0);
      });
      res.json({success:true,orders});
    }catch(error){console.error("Get orders error:",error.message);res.status(500).json({success:false,message:"Unable to load orders."});}
  }
);

app.get(
  "/api/orders/summary",
  protect,
  async (req, res) => {

    try {

      const orders = await Order.find({
        $or: [{userId:req.userId},{user:req.userId}]
      });

      const totalOrders = orders.length;

      const pending = orders.filter(
        order =>
          String(order.status || "").toLowerCase() === "pending"
      ).length;

      const completed = orders.filter(
        order =>
          String(order.status || "").toLowerCase() === "completed"
      ).length;

      const totalSpent = orders.reduce(
        (total, order) =>
          total + Number(order.amount || 0),
        0
      );

      res.json({
        success: true,
        summary: {
          totalOrders,
          pending,
          completed,
          totalSpent
        }
      });

    } catch (error) {

      console.error(
        "Dashboard order summary error:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Unable to load order summary."
      });

    }

  }
);

app.get(
  "/api/orders/:id",
  protect,
  async (req, res) => {

    try {

      const order = await Order.findOne({
        _id: req.params.id,
        $or: [{userId:req.userId},{user:req.userId}]
      });

      if (!order) {

        return res.status(404).json({
          success: false,
          message: "Order not found."
        });

      }

      res.json({
        success: true,
        order
      });

    } catch (error) {

      console.error(
        "Get single order error:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Unable to load order."
      });

    }

  }
);

app.get(
  "/api/orders/:id/status",
  protect,
  async (req, res) => {

    try {

      const order = await Order.findOne({
        _id: req.params.id,
        $or: [{userId:req.userId},{user:req.userId}]
      });

      if (!order) {

        return res.status(404).json({
          success: false,
          message: "Order not found."
        });

      }

      // An order without a provider ID is still awaiting Owlet confirmation.
      if (!order.providerOrderId) {
        return res.json({
          success: true,
          order: {
            id: order._id,
            providerOrderId: "",
            status: order.status || "pending",
            remains: Number(order.remains || 0),
            startCount: Number(order.startCount || 0),
            providerCharge: Number(order.providerCharge || 0),
            refundProcessed: Boolean(order.refundProcessed),
            providerPending: true
          }
        });
      }

      const owletResponse = await axios.post(
        process.env.OWLET_API_URL,
        {
          key: process.env.OWLET_API_KEY,
          action: "status",
          order: order.providerOrderId
        },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );


      console.log(
        "OWLET STATUS RESPONSE:",
        owletResponse.data
      );


      const owletData = owletResponse.data;

      if (
        !owletData ||
        owletData.error
      ) {

        return res.status(400).json({
          success: false,
          message:
            owletData?.error ||
            "Unable to get order status from Owlet."
        });

      }

      const providerStatus =
        String(
          owletData.status || ""
        ).trim();


      if (!providerStatus) {

        return res.status(400).json({
          success: false,
          message: "Owlet did not return an order status."
        });

      }

      const normalizedProviderStatus = providerStatus.toLowerCase().replace(/[_-]+/g, " ").trim();
      const statusMap = {
        "pending": "pending",
        "in progress": "processing",
        "processing": "processing",
        "completed": "completed",
        "complete": "completed",
        "success": "completed",
        "successful": "completed",
        "partial": "partial",
        "cancelled": "cancelled",
        "canceled": "cancelled",
        "refunded": "refunded"
      };
      const newStatus = statusMap[normalizedProviderStatus];

      if (!newStatus) {
        return res.status(502).json({
          success: false,
          message: `Owlet returned an unrecognized order status: ${providerStatus}`
        });
      }

      order.status =
        newStatus;

      order.remains =
        Number(
          owletData.remains || 0
        );

      order.startCount =
        Number(
          owletData.start_count || 0
        );

      order.providerCharge =
        Number(
          owletData.charge || 0
        );

      if (newStatus === "cancelled" || newStatus === "refunded") {
        await refundOrderOnce(order, "REFUND");
      }

      await order.save();

      if (["completed", "cancelled", "refunded"].includes(newStatus)) {
        try {
          await sendOrderStatusEmail(order, newStatus);
        } catch (emailError) {
          console.error(`Order ${newStatus} email error:`, emailError.message || emailError);
        }
      }

      res.json({

        success: true,

        order: {

          id:
            order._id,

          providerOrderId:
            order.providerOrderId,

          status:
            order.status,

          remains:
            order.remains,

          startCount:
            order.startCount,

          providerCharge:
            order.providerCharge,

          refundProcessed:
            order.refundProcessed

        }

      });


    } catch (error) {

      console.error(
        "Order status error:",
        error.response?.data ||
        error.message
      );


      res.status(500).json({

        success: false,

        message:
          "Unable to update order status."

      });

    }

  }
);

// Customer live support. Customers can only read/write their own conversations.
app.get("/api/support/conversation", protect, async (req, res) => {
  try {
    let conversation = await SupportConversation.findOne({ userId: req.userId, status: "open" }).sort({ updatedAt: -1 });
    if (!conversation) conversation = await SupportConversation.create({ userId: req.userId, messages: [] });
    res.json({ success: true, conversation });
  } catch (error) { console.error("Support conversation load failed:", error); res.status(500).json({ success: false, message: "Could not load live chat." }); }
});
app.post("/api/support/conversation/messages", protect, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text || text.length > 2000) return res.status(400).json({ success: false, message: "Enter a message (maximum 2,000 characters)." });
    let conversation = await SupportConversation.findOne({ userId: req.userId, status: "open" }).sort({ updatedAt: -1 });
    if (!conversation) conversation = new SupportConversation({ userId: req.userId, messages: [] });
    conversation.messages.push({ sender: "customer", text }); conversation.lastMessageAt = new Date(); await conversation.save();
    res.status(201).json({ success: true, conversation });
  } catch (error) { console.error("Support message send failed:", error); res.status(500).json({ success: false, message: "Could not send your message." }); }
});
app.get("/api/admin/support/conversations", adminProtect, async (req, res) => {
  try {
    const status = String(req.query.status || "open");
    const filter = status === "all" ? {} : { status: status === "closed" ? "closed" : "open" };
    const conversations = await SupportConversation.find(filter).populate("userId", "fullName email").sort({ lastMessageAt: -1 }).limit(100);
    res.json({ success: true, conversations });
  } catch (error) { console.error("Admin support list failed:", error); res.status(500).json({ success: false, message: "Could not load support inbox." }); }
});
app.get("/api/admin/support/conversations/:id", adminProtect, async (req, res) => {
  try { const conversation = await SupportConversation.findById(req.params.id).populate("userId", "fullName email"); if (!conversation) return res.status(404).json({ success:false, message:"Conversation not found." }); res.json({ success:true, conversation }); }
  catch (error) { res.status(400).json({ success:false, message:"Invalid conversation ID." }); }
});
app.post("/api/admin/support/conversations/:id/messages", adminProtect, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim(); if (!text || text.length > 2000) return res.status(400).json({success:false,message:"Enter a message (maximum 2,000 characters)."});
    const conversation = await SupportConversation.findById(req.params.id); if (!conversation) return res.status(404).json({success:false,message:"Conversation not found."});
    conversation.messages.push({sender:"admin",text}); conversation.lastMessageAt=new Date(); conversation.status="open"; await conversation.save();
    res.status(201).json({success:true,conversation});
  } catch(error) { console.error("Admin reply failed:",error); res.status(500).json({success:false,message:"Could not send reply."}); }
});
app.patch("/api/admin/support/conversations/:id", adminProtect, async (req,res) => {
  try { const status = req.body?.status; if(!["open","closed"].includes(status)) return res.status(400).json({success:false,message:"Invalid status."}); const conversation=await SupportConversation.findByIdAndUpdate(req.params.id,{status},{new:true}).populate("userId","fullName email"); if(!conversation)return res.status(404).json({success:false,message:"Conversation not found."}); res.json({success:true,conversation}); }
  catch(error){res.status(400).json({success:false,message:"Could not update conversation."});}
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminPassword = String(process.env.ADMIN_PASSWORD || "");

    if (!adminEmail || !adminPassword) {
      return res.status(503).json({
        success: false,
        message: "Admin credentials are not configured on the server."
      });
    }

    if (
      String(email || "").trim().toLowerCase() !== adminEmail ||
      String(password || "") !== adminPassword
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin email or password."
      });
    }

    const token = jwt.sign(
      {
        admin: true,
        email: adminEmail
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({
      success: true,
      message: "Admin login successful.",
      token,
      admin: {
        email: adminEmail
      }
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to login as admin."
    });
  }
});

app.get("/api/admin/me", adminProtect, (req, res) => {
  res.json({
    success: true,
    admin: {
      email: req.adminEmail
    }
  });
});

app.get("/api/admin/dashboard", adminProtect, async (req, res) => {
  try {
    const [
      userCount,
      orderCount,
      transactionCount,
      users,
      successfulDeposits,
      successfulOrders,
      pendingOrders,
      completedOrders,
      refundedOrders
    ] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Transaction.countDocuments(),
      User.find().select("fullName email balance active createdAt").sort({ createdAt: -1 }).limit(8),
      Transaction.aggregate([
        { $match: { type: "deposit", status: "successful" } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),
      Transaction.aggregate([
        { $match: { type: "order", status: "successful" } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),
      Order.countDocuments({ status: { $in: ["pending", "processing", "in progress"] } }),
      Order.countDocuments({ status: "completed" }),
      Order.countDocuments({ status: { $in: ["cancelled", "refunded"] } })
    ]);

    const totalWalletBalance = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } }
    ]);

    res.json({
      success: true,
      stats: {
        users: userCount,
        orders: orderCount,
        transactions: transactionCount,
        walletBalance: Number(totalWalletBalance[0]?.total || 0),
        deposits: Number(successfulDeposits[0]?.total || 0),
        sales: Number(successfulOrders[0]?.total || 0),
        pendingOrders,
        completedOrders,
        refundedOrders
      },
      recentUsers: users
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load admin dashboard."
    });
  }
});

app.get("/api/admin/users", adminProtect, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);

    const filter = search
      ? {
          $or: [
            { fullName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } }
          ]
        }
      : {};

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("fullName email balance active createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Admin users error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load users."
    });
  }
});

app.post("/api/admin/users/:id/wallet", adminProtect, async (req, res) => {
  try {
    const { action, amount, reason } = req.body;
    const value = Number(amount);
    const note = String(reason || "").trim();

    if (!["credit", "debit"].includes(action) || !Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid wallet action and positive amount."
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    if (!note) {
      return res.status(400).json({
        success: false,
        message: "Please provide a reason for this wallet adjustment."
      });
    }

    if (action === "debit" && Number(user.balance || 0) < value) {
      return res.status(400).json({
        success: false,
        message: "User does not have enough wallet balance."
      });
    }

    const previousBalance = Number(user.balance || 0);
    user.balance =
      action === "credit"
        ? previousBalance + value
        : previousBalance - value;

    await user.save();

    await Transaction.create({
      userId: user._id,
      txRef: `ADMIN-${action.toUpperCase()}-${user._id}-${Date.now()}`,
      type: action === "credit" ? "admin_credit" : "admin_debit",
      amount: value,
      currency: "NGN",
      status: "successful"
    });

    await adminLog(
      req,
      action === "credit" ? "Credited user wallet" : "Debited user wallet",
      "user",
      user._id,
      `Email=${user.email}; Amount=NGN ${value.toLocaleString()}; Previous=NGN ${previousBalance.toLocaleString()}; New=NGN ${Number(user.balance).toLocaleString()}; Reason=${note}`
    );

    res.json({
      success: true,
      message: `Wallet ${action}ed successfully.`,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        balance: user.balance
      },
      reason: String(reason || "").trim()
    });
  } catch (error) {
    console.error("Admin wallet adjustment error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to update user wallet."
    });
  }
});

app.get("/api/admin/orders", adminProtect, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);

    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (search) {
      const matchingUsers = await User.find({
        $or: [
          { fullName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      filter.$or = [
        { providerOrderId: { $regex: search, $options: "i" } },
        { serviceName: { $regex: search, $options: "i" } },
        { link: { $regex: search, $options: "i" } },
        { userId: { $in: matchingUsers.map(u => u._id) } },
        { user: { $in: matchingUsers.map(u => u._id) } }
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("userId", "fullName email balance")
        .populate("user", "fullName email balance")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(filter)
    ]);

    res.json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Admin orders error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load orders."
    });
  }
});

app.get("/api/admin/transactions", adminProtect, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);

    const [transactions, total] = await Promise.all([
      Transaction.find()
        .populate("userId", "fullName email")
        .populate("user", "fullName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Transaction.countDocuments()
    ]);

    res.json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Admin transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load transactions."
    });
  }
});

app.get("/api/admin/provider",adminProtect,async(req,res)=>{
 try{
  const [balanceResponse,raw]=await Promise.all([axios.post(process.env.OWLET_API_URL,{key:process.env.OWLET_API_KEY,action:"balance"},{timeout:10000}),getOwletServicesCached()]);
  const saved=await ServicePrice.find({}).lean(),map=new Map(saved.map(x=>[String(x.serviceId),x]));
  const services=raw.map(x=>{const id=String(x.service),p=Number(x.rate||0),o=map.get(id);return {service:id,name:o?.displayName||x.name,category:o?.category||x.category,type:x.type,providerRate:p,sellingRate:o&&Number(o.sellingRate)>0?Number(o.sellingRate):p*1.6835,enabled:o?.enabled!==false,min:id==="8288"?50:id==="23425"?200:(o?.minOverride??x.min),max:o?.maxOverride??x.max};});
  res.json({success:true,balance:balanceResponse.data,services});
 }catch(e){console.error("Admin provider error:",e.response?.data||e.message);res.status(502).json({success:false,message:"Unable to load provider information."});}
});

app.get("/api/admin/prices",adminProtect,async(req,res)=>{
 try{
  let raw=Array.isArray(owletServicesCache)?owletServicesCache:[],refreshing=Date.now()-owletServicesCacheAt>OWLET_SERVICES_CACHE_TTL_MS;
  if(!raw.length){raw=await getOwletServicesCached();refreshing=false;}
  else if(refreshing&&!owletServicesRequestInFlight)getOwletServicesCached().catch(e=>console.warn("Background Owlet refresh:",e.message));
  const saved=await ServicePrice.find({}).lean(),map=new Map(saved.map(x=>[String(x.serviceId),x]));
  const services=raw.map(x=>{const id=String(x.service),p=Number(x.rate||0),o=map.get(id);return {serviceId:id,name:o?.displayName||x.name,category:o?.category||x.category||"Other",providerRate:p,sellingRate:o?Number(o.sellingRate):p*1.6835,customized:!!o,min:o?.minOverride??x.min,max:o?.maxOverride??x.max,enabled:o?.enabled!==false};});
  res.json({success:true,services,refreshing});
 }catch(e){res.status(500).json({success:false,message:"Unable to load service prices."});}
});

app.put("/api/admin/prices/:serviceId",adminProtect,async(req,res)=>{
 try{
  const serviceId=String(req.params.serviceId),sellingRate=Number(req.body.sellingRate);
  if(!Number.isFinite(sellingRate)||sellingRate<0)return res.status(400).json({success:false,message:"Enter a valid selling price."});
  let raw=Array.isArray(owletServicesCache)?owletServicesCache:[];
  if(!raw.length)raw=await getOwletServicesCached();
  const service=raw.find(x=>String(x.service)===serviceId);
  if(!service)return res.status(404).json({success:false,message:"Provider service not found."});
  const saved=await ServicePrice.findOneAndUpdate({serviceId},{serviceId,name:service.name||"",category:service.category||"",providerRate:Number(service.rate||0),sellingRate,updatedBy:req.adminEmail||"admin"},{new:true,upsert:true,setDefaultsOnInsert:true});
  res.json({success:true,message:"Selling price updated successfully.",price:saved});
 }catch(e){res.status(500).json({success:false,message:"Unable to update selling price."});}
});

app.delete("/api/admin/prices/:serviceId", adminProtect, async (req, res) => {
  try {
    await ServicePrice.deleteOne({ serviceId: String(req.params.serviceId) });
    res.json({ success: true, message: "Custom price removed. The default markup will be used again." });
  } catch (error) {
    console.error("Reset service price error:", error.message);
    res.status(500).json({ success: false, message: "Unable to reset service price." });
  }
});
async function adminLog(req, action, targetType = "", targetId = "", details = "") {
  try { await AdminLog.create({ adminEmail: req.adminEmail || req.admin?.email || "admin", action, targetType, targetId: String(targetId || ""), details }); } catch (e) { console.error("Admin log error:", e.message); }
}

app.get("/api/admin/activity", adminProtect, async (req, res) => {
  try {
    const logs = await AdminLog.find({}).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, logs });
  } catch (e) { res.status(500).json({ success:false, message:"Unable to load activity logs." }); }
});
app.get("/api/admin/services",adminProtect,async(req,res)=>{
 try{
  let raw=Array.isArray(owletServicesCache)?owletServicesCache:[];
  let refreshing=Date.now()-owletServicesCacheAt>OWLET_SERVICES_CACHE_TTL_MS;
  // On a cold start, wait for one bounded provider fetch so the admin does not
  // receive an empty list and assume there are no services.
  if(!raw.length){raw=await getOwletServicesCached();refreshing=false;}
  else if(refreshing&&!owletServicesRequestInFlight){getOwletServicesCached().catch(e=>console.warn("Background Owlet refresh:",e.message));}
  const saved=await ServicePrice.find({}).lean(),map=new Map(saved.map(x=>[String(x.serviceId),x]));
  const services=raw.filter(shouldExposeService).map(x=>{const id=String(x.service),o=map.get(id),providerRate=Number(x.rate||0);return {serviceId:id,name:x.name,category:o?.category||x.category||"Other",providerRate,sellingRate:o&&Number(o.sellingRate)>0?Number(o.sellingRate):providerRate*1.6835,min:x.min,max:x.max,enabled:o?.enabled!==false,displayName:o?.displayName||x.name,description:o?.description||"",minOverride:o?.minOverride??null,maxOverride:o?.maxOverride??null};});
  res.json({success:true,services,refreshing});
 }catch(e){console.error("Admin services catalogue error:",e.response?.data||e.message);res.status(502).json({success:false,message:"Unable to load Owlet services. Check the Owlet API URL and key in Render."});}
});
app.put("/api/admin/services/:serviceId",adminProtect,async(req,res)=>{
 try{
  const serviceId=String(req.params.serviceId),body=req.body||{};
  if(body.sellingRate!==undefined&&(!Number.isFinite(Number(body.sellingRate))||Number(body.sellingRate)<0))return res.status(400).json({success:false,message:"Enter a valid selling price."});
  let raw=Array.isArray(owletServicesCache)?owletServicesCache:[];
  if(!raw.length)raw=await getOwletServicesCached();
  const service=raw.find(x=>String(x.service)===serviceId);
  if(!service)return res.status(404).json({success:false,message:"Provider service not found."});
  const saved=await ServicePrice.findOneAndUpdate({serviceId},{
   serviceId,name:service.name||"",category:String(body.category||service.category||""),
   providerRate:Number(service.rate||0),sellingRate:Number(body.sellingRate??(Number(service.rate||0)*1.6835)),
   enabled:body.enabled!==false,displayName:String(body.displayName||service.name||""),
   description:String(body.description||""),
   minOverride:body.minOverride===""||body.minOverride==null?null:Number(body.minOverride),
   maxOverride:body.maxOverride===""||body.maxOverride==null?null:Number(body.maxOverride),
   updatedBy:req.adminEmail||"admin"
  },{new:true,upsert:true,setDefaultsOnInsert:true});
  await adminLog(req,"Updated service","service",serviceId,`Enabled=${saved.enabled}; display=${saved.displayName}`);
  res.json({success:true,message:"Service updated successfully.",service:saved});
 }catch(e){res.status(500).json({success:false,message:"Unable to update service."});}
});
app.patch("/api/admin/users/:id/status", adminProtect, async (req,res)=>{
  try { const user=await User.findByIdAndUpdate(req.params.id,{active:req.body.active!==false},{new:true}).select("fullName email balance active createdAt"); if(!user)return res.status(404).json({success:false,message:"User not found."}); await adminLog(req,user.active?"Activated user":"Suspended user","user",user._id,user.email); res.json({success:true,user}); }
  catch(e){res.status(500).json({success:false,message:"Unable to update user status."});}
});
app.get("/api/admin/users/:id", adminProtect, async (req,res)=>{
  try { const user=await User.findById(req.params.id).select("-password -resetPasswordToken -resetPasswordExpires"); if(!user)return res.status(404).json({success:false,message:"User not found."}); const orders=await Order.find({userId:user._id}).sort({createdAt:-1}).limit(50); const transactions=await Transaction.find({userId:user._id}).sort({createdAt:-1}).limit(50); res.json({success:true,user,orders,transactions}); }
  catch(e){res.status(500).json({success:false,message:"Unable to load user details."});}
});
app.patch("/api/admin/orders/:id", adminProtect, async (req,res)=>{
  try {
    const order=await Order.findById(req.params.id); if(!order)return res.status(404).json({success:false,message:"Order not found."});
    const status=String(req.body.status||order.status).toLowerCase();
    if (!["pending","processing","completed","partial","cancelled","refunded"].includes(status)) return res.status(400).json({success:false,message:"Invalid order status."});
    if (status === "cancelled" || status === "refunded") {
      await refundOrderOnce(order, "REFUND");
    }
    order.status=status; await order.save();
    if (["completed", "cancelled", "refunded"].includes(status)) {
      try { await sendOrderStatusEmail(order, status); }
      catch (emailError) { console.error(`Admin order ${status} email error:`, emailError.message || emailError); }
    }
    await adminLog(req,"Updated order status","order",order._id,`Status=${status}`); res.json({success:true,message:"Order updated.",order});
  } catch(e){res.status(500).json({success:false,message:"Unable to update order."});}
});
app.get("/api/admin/deposits", adminProtect, async (req,res)=>{
  try { const transactions=await Transaction.find({type:"deposit"}).populate("userId","fullName email").populate("user","fullName email").sort({createdAt:-1}).limit(200); res.json({success:true,transactions}); }
  catch(e){res.status(500).json({success:false,message:"Unable to load deposits."});}
});
app.get("/api/admin/withdrawals", adminProtect, async (req,res)=>{
  try { const withdrawals=await Withdrawal.find({}).populate("userId","fullName email").populate("user","fullName email").sort({createdAt:-1}).limit(200); res.json({success:true,withdrawals}); }
  catch(e){res.status(500).json({success:false,message:"Unable to load withdrawals."});}
});
app.patch("/api/admin/withdrawals/:id", adminProtect, async (req,res)=>{
  try { const w=await Withdrawal.findById(req.params.id); if(!w)return res.status(404).json({success:false,message:"Withdrawal not found."}); const next=String(req.body.status||""); if(!["pending","approved","rejected"].includes(next))return res.status(400).json({success:false,message:"Invalid withdrawal status."}); w.status=next; w.note=String(req.body.note||w.note||""); await w.save(); await adminLog(req,`Withdrawal ${next}`,"withdrawal",w._id,w.note); res.json({success:true,withdrawal:w}); }
  catch(e){res.status(500).json({success:false,message:"Unable to update withdrawal."});}
});
app.get("/api/admin/coupons", adminProtect, async (req,res)=>{ try{res.json({success:true,coupons:await Coupon.find({}).sort({createdAt:-1})});}catch(e){res.status(500).json({success:false,message:"Unable to load coupons."});} });
app.post("/api/admin/coupons", adminProtect, async (req,res)=>{ try{const b=req.body||{}; const coupon=await Coupon.create({code:String(b.code||"").trim().toUpperCase(),type:b.type||"percent",value:Number(b.value||0),minOrder:Number(b.minOrder||0),maxDiscount:Number(b.maxDiscount||0),usageLimit:Number(b.usageLimit||0),expiresAt:b.expiresAt||null,active:b.active!==false}); await adminLog(req,"Created coupon","coupon",coupon._id,coupon.code); res.json({success:true,coupon});}catch(e){res.status(400).json({success:false,message:e.code===11000?"Coupon code already exists.":"Unable to create coupon."});} });
app.patch("/api/admin/coupons/:id", adminProtect, async (req,res)=>{ try{const allowed=["code","type","value","minOrder","maxDiscount","usageLimit","expiresAt","active"];const update={};for(const k of allowed)if(req.body[k]!==undefined)update[k]=k==="code"?String(req.body[k]).toUpperCase():req.body[k];const c=await Coupon.findByIdAndUpdate(req.params.id,update,{new:true});if(!c)return res.status(404).json({success:false,message:"Coupon not found."});await adminLog(req,"Updated coupon","coupon",c._id,c.code);res.json({success:true,coupon:c});}catch(e){res.status(400).json({success:false,message:"Unable to update coupon."});} });
app.delete("/api/admin/coupons/:id", adminProtect, async (req,res)=>{try{await Coupon.findByIdAndDelete(req.params.id);await adminLog(req,"Deleted coupon","coupon",req.params.id);res.json({success:true,message:"Coupon deleted."});}catch(e){res.status(500).json({success:false,message:"Unable to delete coupon."});}});
app.get("/api/admin/announcements", adminProtect, async(req,res)=>{try{res.json({success:true,announcements:await Announcement.find({}).sort({createdAt:-1})});}catch(e){res.status(500).json({success:false,message:"Unable to load announcements."});}});
app.post("/api/admin/announcements", adminProtect, async(req,res)=>{try{const a=await Announcement.create(req.body);await adminLog(req,"Created announcement","announcement",a._id,a.title);res.json({success:true,announcement:a});}catch(e){res.status(400).json({success:false,message:"Unable to create announcement."});}});
app.patch("/api/admin/announcements/:id", adminProtect, async(req,res)=>{try{const a=await Announcement.findByIdAndUpdate(req.params.id,req.body,{new:true});if(!a)return res.status(404).json({success:false,message:"Announcement not found."});await adminLog(req,"Updated announcement","announcement",a._id,a.title);res.json({success:true,announcement:a});}catch(e){res.status(400).json({success:false,message:"Unable to update announcement."});}});
app.delete("/api/admin/announcements/:id", adminProtect, async(req,res)=>{try{await Announcement.findByIdAndDelete(req.params.id);await adminLog(req,"Deleted announcement","announcement",req.params.id);res.json({success:true,message:"Announcement deleted."});}catch(e){res.status(500).json({success:false,message:"Unable to delete announcement."});}});
app.get("/api/announcements", async(req,res)=>{try{const now=new Date();const announcements=await Announcement.find({active:true,$or:[{expiresAt:null},{expiresAt:{$gt:now}}]}).sort({createdAt:-1}).limit(10);res.json({success:true,announcements});}catch(e){res.status(500).json({success:false,message:"Unable to load announcements."});}});
app.get("/api/admin/settings", adminProtect, async(req,res)=>{res.json({success:true,settings:{websiteName:process.env.WEBSITE_NAME||"PK-BOOSTER",supportEmail:process.env.SUPPORT_EMAIL||"",whatsapp:process.env.SUPPORT_WHATSAPP||"",currency:"NGN",maintenanceMode:process.env.MAINTENANCE_MODE==="true",registrationEnabled:process.env.REGISTRATION_ENABLED!=="false",defaultMarkup:68.35}});});
app.put("/api/admin/settings", adminProtect, async(req,res)=>{try{const envPath=path.join(__dirname,".env");let env=fs.existsSync(envPath)?fs.readFileSync(envPath,"utf8"):"";const fields={WEBSITE_NAME:req.body.websiteName,SUPPORT_EMAIL:req.body.supportEmail,SUPPORT_WHATSAPP:req.body.whatsapp,MAINTENANCE_MODE:req.body.maintenanceMode?"true":"false",REGISTRATION_ENABLED:req.body.registrationEnabled===false?"false":"true"};for(const [k,v] of Object.entries(fields)){const line=`${k}=${String(v??"").replace(/\n/g,"")}`;const re=new RegExp(`^${k}=.*$`,`m`);env=re.test(env)?env.replace(re,line):env+`\n${line}`;}fs.writeFileSync(envPath,env);for(const[k,v]of Object.entries(fields))process.env[k]=v;await adminLog(req,"Updated website settings","settings","",Object.keys(fields).join(","));res.json({success:true,message:"Settings saved."});}catch(e){res.status(500).json({success:false,message:"Unable to save settings."});}});
app.post("/api/admin/change-password", adminProtect, async(req,res)=>{try{const current=String(req.body.currentPassword||"");const next=String(req.body.newPassword||"");if(current!==String(process.env.ADMIN_PASSWORD||""))return res.status(401).json({success:false,message:"Current password is incorrect."});if(next.length<8)return res.status(400).json({success:false,message:"New password must be at least 8 characters."});const envPath=path.join(__dirname,".env");let env=fs.existsSync(envPath)?fs.readFileSync(envPath,"utf8"):"";const re=/^ADMIN_PASSWORD=.*$/m;env=re.test(env)?env.replace(re,`ADMIN_PASSWORD=${next}`):env+`\nADMIN_PASSWORD=${next}`;fs.writeFileSync(envPath,env);process.env.ADMIN_PASSWORD=next;await adminLog(req,"Changed admin password");res.json({success:true,message:"Admin password changed. Please log in again."});}catch(e){res.status(500).json({success:false,message:"Unable to change admin password."});}});
app.get("/api/admin/revenue", adminProtect, async(req,res)=>{try{const orders=await Order.find({}).lean();const sales=orders.reduce((a,o)=>a+Number(o.amount||0),0);const provider=orders.reduce((a,o)=>a+Number(o.providerCharge||0),0);const completed=orders.filter(o=>String(o.status).toLowerCase()==="completed");res.json({success:true,summary:{sales,providerCost:provider,profit:sales-provider,completedOrders:completed.length},orders:orders.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,200)});}catch(e){res.status(500).json({success:false,message:"Unable to load revenue report."});}});


// PK-BOOSTER compatibility routes and Paystack wallet deposits.
app.get("/wallet",protect,async(req,res)=>{try{const user=await User.findById(req.userId).select("balance");if(!user)return res.status(404).json({message:"User not found."});const transactions=await Transaction.find({$or:[{userId:req.userId},{user:req.userId}]}).sort({createdAt:-1}).limit(100);res.json({balance:Number(user.balance||0),referralEarnings:0,transactions});}catch(e){res.status(500).json({message:"Unable to load wallet."});}});
app.get("/transactions",protect,async(req,res)=>{try{res.json({transactions:await Transaction.find({$or:[{userId:req.userId},{user:req.userId}]}).sort({createdAt:-1}).limit(100)});}catch(e){res.status(500).json({message:"Unable to load transactions."});}});
app.get("/services",async(req,res)=>{try{const r=await getOwletServicesCached(),saved=await ServicePrice.find({}).lean(),map=new Map(saved.map(x=>[String(x.serviceId),x]));const services=r.filter(shouldExposeService).map(x=>{const id=String(x.service),o=map.get(id),p=Number(x.rate||0),price=o?Number(o.sellingRate):p*1.6835,tiktok=["8288","23425","21632","23148","20884"].includes(id),text=`${x.name||""} ${x.category||""}`.toLowerCase(),platform=tiktok?"TikTok":/instagram/.test(text)?"Instagram":/facebook/.test(text)?"Facebook":/youtube/.test(text)?"YouTube":/telegram/.test(text)?"Telegram":/whatsapp/.test(text)?"WhatsApp":(x.category||"Other"),boostType=id==="21632"?"Likes":["23148","20884"].includes(id)?"Views":["8288","23425"].includes(id)?"Followers":(x.type||x.category||"Other");return {service:id,serviceId:id,providerServiceId:id,name:o?.displayName||x.name,platform,type:boostType,boostType,price,pricePer1000:price,min:id==="8288"?50:id==="23425"?200:(o?.minOverride??x.min),max:o?.maxOverride??x.max};}).filter(x=>map.get(x.service)?.enabled!==false);res.json({success:true,services});}catch(e){res.status(502).json({message:"Unable to load services."});}});
app.post("/payments/initialize",protect,async(req,res)=>{try{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<100)return res.status(400).json({message:"Minimum deposit is ₦100."});if(!process.env.PAYSTACK_SECRET_KEY)return res.status(503).json({message:"Paystack is not configured."});const user=await User.findById(req.userId),reference=`PKB-${user._id}-${Date.now()}`;const response=await axios.post("https://api.paystack.co/transaction/initialize",{email:user.email,amount:Math.round(amount*100),reference,callback_url:process.env.PAYSTACK_CALLBACK_URL||"https://pk-booster.com/payment-callback.html",metadata:{userId:String(user._id)}},{timeout:15000,headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});res.json({authorization_url:response.data.data.authorization_url,reference});}catch(e){res.status(502).json({message:e.response?.data?.message||"Unable to initialize payment."});}});
async function verifyPaystackDeposit(reference,expectedUserId){
 const response=await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{timeout:15000,headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});
 const p=response.data?.data;
 if(!p||p.status!=="success"||p.currency!=="NGN")throw new Error("Payment has not been confirmed.");
 const uid=String(p.metadata?.userId||expectedUserId||"");
 if(expectedUserId&&uid!==String(expectedUserId))throw new Error("Payment does not belong to this account.");
 const user=await User.findById(uid);if(!user)throw new Error("Payment account not found.");
 const amount=Number(p.amount)/100;
 try{
  await Transaction.create({userId:user._id,txRef:reference,reference,type:"deposit",amount,currency:"NGN",status:"successful",note:"Paystack deposit"});
 }catch(error){
  if(error.code===11000)return {credited:false,balance:Number(user.balance||0),message:"Deposit already credited."};
  throw error;
 }
 const updated=await User.findByIdAndUpdate(user._id,{$inc:{balance:amount}},{new:true});
 await Transaction.updateOne({txRef:reference},{$set:{balanceAfter:Number(updated.balance||0)}});
 return {credited:true,balance:Number(updated.balance||0),message:"Deposit successful."};
}
app.get("/payments/verify/:reference",protect,async(req,res)=>{try{if(!process.env.PAYSTACK_SECRET_KEY)return res.status(503).json({message:"Paystack is not configured."});res.json(await verifyPaystackDeposit(req.params.reference,req.userId));}catch(e){res.status(400).json({message:e.response?.data?.message||e.message||"Unable to verify payment."});}});
app.post("/payments/webhook",async(req,res)=>{try{const signature=req.headers["x-paystack-signature"],expected=crypto.createHmac("sha512",process.env.PAYSTACK_SECRET_KEY||"").update(JSON.stringify(req.body)).digest("hex");if(!signature||signature!==expected)return res.status(401).send("Invalid signature");if(req.body?.event==="charge.success"&&req.body.data?.reference&&req.body.data?.metadata?.userId)await verifyPaystackDeposit(req.body.data.reference,req.body.data.metadata.userId);res.sendStatus(200);}catch(e){console.error("Paystack webhook:",e.message);res.sendStatus(500);}});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {

  console.log(
    `PK-BOOSTER server running on http://localhost:${PORT}`
  );

});