require("dotenv").config();

const dns = require("dns");
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json());

const userSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        password: {
            type: String,
            required: true
        },

        balance: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

const User = mongoose.model("User", userSchema);

function createToken(user) {
    return jwt.sign(
        {
            id: user._id
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );
}

function authenticateToken(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Authentication required."
        });
    }

    const token = authorization.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.userId = decoded.id;

        next();
    } catch {
        return res.status(401).json({
            message: "Invalid or expired token."
        });
    }
}

app.get("/", (req, res) => {
    res.json({
        message: "PK-BOOSTER API is running."
    });
});

app.post("/register", async (req, res) => {
    try {
        const { fullName, email, password } = req.body;

        if (!fullName || !email || !password) {
            return res.status(400).json({
                message: "Please provide your full name, email, and password."
            });
        }

        if (fullName.trim().length < 2) {
            return res.status(400).json({
                message: "Your full name must contain at least 2 characters."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Your password must contain at least 8 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const existingUser = await User.findOne({
            email: normalizedEmail
        });

        if (existingUser) {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await User.create({
            fullName: fullName.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            balance: 0
        });

        return res.status(201).json({
            message: "Account created successfully.",
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                balance: user.balance
            }
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        console.error("Registration error:", error.message);

        return res.status(500).json({
            message: "Unable to create account."
        });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Please enter your email and password."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const user = await User.findOne({
            email: normalizedEmail
        });

        if (!user) {
            return res.status(401).json({
                message: "Incorrect email or password."
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Incorrect email or password."
            });
        }

        const token = createToken(user);

        return res.json({
            message: "Login successful.",
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                balance: user.balance
            }
        });

    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            message: "Unable to log in."
        });
    }
});

app.get("/me", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("-password");

        if (!user) {
            return res.status(404).json({
                message: "User not found."
            });
        }

        return res.json({
            user: {
                id: user._id,
                fullName: user.fullName,
                email: user.email,
                balance: user.balance
            }
        });

    } catch (error) {
        console.error("User lookup error:", error.message);

        return res.status(500).json({
            message: "Unable to retrieve account."
        });
    }
});

app.post("/logout", (req, res) => {
    res.json({
        message: "Logged out successfully. Remove your token from the browser."
    });
});

async function startServer() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is missing.");
        }

        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing.");
        }

        dns.setServers(["8.8.8.8", "8.8.4.4"]);

        await mongoose.connect(process.env.MONGODB_URI);

        console.log("MongoDB connected successfully.");

        const PORT = process.env.PORT || 5000;

        app.listen(PORT, () => {
            console.log(`PK-BOOSTER server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("Server startup error:", error.message);

        process.exit(1);
    }
}

startServer();