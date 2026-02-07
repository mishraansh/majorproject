if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const ejsMate = require("ejs-mate");
const methodOverride = require("method-override");
const multer = require("multer");

const session = require("express-session");
const MongoStore = require("connect-mongo").default; //
const flash = require("connect-flash");

const passport = require("passport");
const LocalStrategy = require("passport-local");

const Listing = require("./models/listing.js");
const Review = require("./models/review.js");
const User = require("./models/user.js");

const wrapAsync = require("./utils/wrapAsync.js");
const ExpressError = require("./utils/ExpressError.js");

// Cloudinary configuration

const { storage } = require("./cloudConfig.js");
const upload = multer({ storage });

const {
  isLoggedIn,
  saveRedirectUrl,
  isOwner,
  validateListing,
  validateReview,
  isReviewAuthor,
} = require("./middleware.js");

/* ================= APP CONFIG ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ================= DATABASE ================= */

const dbUrl = process.env.ATLASDB_URL;
if (!dbUrl) {
  console.error(" ATLASDB_URL not defined in .env");
  process.exit(1);
}

mongoose
  .connect(dbUrl)
  .then(() => console.log(" Connected to MongoDB"))
  .catch((err) => {
    console.error(" MongoDB connection error:", err.message);
    process.exit(1);
  });

/* ================= SESSION & PASSPORT ================= */

app.set("trust proxy", 1);

const store = MongoStore.create({
  mongoUrl: dbUrl,
  crypto: { secret: process.env.SESSION_SECRET },
  touchAfter: 24 * 3600,
});


app.use(
  session({
    store,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: true,        // Render HTTPS
      sameSite: "none",    // LOGIN FIX
    },
  })
);

app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  res.locals.mapToken = process.env.MAP_TOKEN; // Mapbox token for views
  next();
});

/* ================= ROUTES ================= */

// Home / listings
app.get("/listings", async (req, res) => {
  const allListings = await Listing.find({});
  res.render("listings/index", { allListings });
});

/* ---------- AUTH ---------- */

app.get("/signup", (req, res) => {
  res.render("users/signup.ejs");
});

app.post("/signup", async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const newUser = new User({ email, username });
    const registeredUser = await User.register(newUser, password);

    req.login(registeredUser, (err) => {
      if (err) return next(err);
      req.flash("success", "Welcome to Wanderlust!");
      res.redirect("/listings");
    });
  } catch (e) {
    req.flash("error", e.message);
    res.redirect("/signup");
  }
});

app.get("/login", (req, res) => {
  res.render("users/login.ejs");
});

app.post(
  "/login",
  saveRedirectUrl,
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (req, res) => {
    req.flash("success", "Welcome back to Wanderlust!");
    const redirectUrl = res.locals.redirectUrl || "/listings";
    res.redirect(redirectUrl);
  }
);

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "You are logged out");
    res.redirect("/listings");
  });
});

/* ---------- LISTINGS ---------- */

app.get("/listing/new", isLoggedIn, (req, res) => {
  res.render("listings/new.ejs");
});

app.get("/listings/:id", async (req, res) => {
  const listing = await Listing.findById(req.params.id)
    .populate({ path: "reviews", populate: { path: "author" } })
    .populate("owner");

  if (!listing) {
    req.flash("error", "Listing does not exist!");
    return res.redirect("/listings");
  }

  res.render("listings/show.ejs", { listing });
});

app.post(
  "/listings",
  isLoggedIn,
  validateListing,
  upload.single("listing[image]"),
  wrapAsync(async (req, res) => {
    const newListing = new Listing(req.body.listing);
    newListing.owner = req.user._id;
    newListing.image = {
      url: req.file.path,
      filename: req.file.filename,
    };
    await newListing.save();
    req.flash("success", "New Listing Created!");
    res.redirect("/listings");
  })
);

app.get("/listings/:id/edit", isLoggedIn, isOwner, async (req, res) => {
  const listing = await Listing.findById(req.params.id);
  if (!listing) {
    req.flash("error", "Listing does not exist!");
    return res.redirect("/listings");
  }
  res.render("listings/edit.ejs", { listing });
});

app.put(
  "/listings/:id",
  isLoggedIn,
  isOwner,
  upload.single("listing[image]"),
  validateListing,
  async (req, res) => {
    const listing = await Listing.findByIdAndUpdate(req.params.id, {
      ...req.body.listing,
    });
    if (req.file) {
      listing.image = {
        url: req.file.path,
        filename: req.file.filename,
      };
      await listing.save();
    }
    req.flash("success", "Listing Updated");
    res.redirect(`/listings/${req.params.id}`);
  }
);

app.delete("/listings/:id", isLoggedIn, isOwner, async (req, res) => {
  await Listing.findByIdAndDelete(req.params.id);
  req.flash("success", "Listing Deleted");
  res.redirect("/listings");
});

/* ---------- REVIEWS ---------- */

app.post(
  "/listings/:id/reviews",
  isLoggedIn,
  validateReview,
  wrapAsync(async (req, res) => {
    const listing = await Listing.findById(req.params.id);
    const newReview = new Review(req.body.review);
    newReview.author = req.user._id;
    listing.reviews.push(newReview);
    await newReview.save();
    await listing.save();
    res.redirect(`/listings/${listing._id}`);
  })
);

app.delete(
  "/listings/:id/reviews/:reviewId",
  isLoggedIn,
  isReviewAuthor,
  wrapAsync(async (req, res) => {
    await Listing.findByIdAndUpdate(req.params.id, {
      $pull: { reviews: req.params.reviewId },
    });
    await Review.findByIdAndDelete(req.params.reviewId);
    res.redirect(`/listings/${req.params.id}`);
  })
);

/* ---------- ERROR HANDLING ---------- */

app.use((req, res, next) => {
  next(new ExpressError(404, "Page Not Found"));
});

app.use((err, req, res, next) => {
  const { statusCode = 500 } = err;
  res.status(statusCode).render("error.ejs", { err });
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(` Server running on port ${PORT}`);
});



