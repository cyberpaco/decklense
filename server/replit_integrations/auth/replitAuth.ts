import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import crypto from "crypto";

export function getSession() {
  const sessionTtl = 365 * 24 * 60 * 60 * 1000; // 1 year for persistent guest sessions
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl / 1000,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET || "fallback_secret_for_local_dev",
    store: sessionStore,
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    try {
      const sess = req.session as any;
      if (!sess.anonymousId) {
        sess.anonymousId = crypto.randomUUID();
      }
      
      const guestId = sess.anonymousId;

      const userClaims: any = {
        sub: guestId,
        email: `${guestId}@anonymous.local`,
        first_name: "Anonymous",
        last_name: "Collector",
        profile_image_url: ""
      };
      
      await upsertUser(userClaims);

      const user = {
        claims: userClaims,
        access_token: "mock_access_token",
        refresh_token: "mock_refresh_token",
        expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
      };

      req.login(user, (err: any) => {
        if (err) return next(err);
        res.redirect("/");
      });
    } catch (err: any) {
      next(err);
    }
  });

  app.get("/api/callback", (req, res) => {
    // Left for safety if any old frontends try to hit callback directly
    res.redirect("/");
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      // Because we use persistent anonymous sessions, to fully logout we should destroy the session
      req.session.destroy(() => {
        res.redirect("/");
      });
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  // Session expired
  req.logout(() => {
    res.status(401).json({ message: "Session expired" });
  });
};
