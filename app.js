if (process.env.NODE_ENV != "production") {
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
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const Listing = require("./models/listing.js");
const Review = require("./models/review.js");
const User = require("./models/user.js");
const wrapAsync = require("./utils/wrapAsync.js");
const ExpressError = require("./utils/ExpressError.js");
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "/public")));

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ================= DATABASE ================= */

const dbUrl = process.env.ATLASDB_URL;
if (!dbUrl) throw new Error("ATLASDB_URL not defined");

async function main() {
  try {
    await mongoose.connect(dbUrl);
    console.log(" Connected to MongoDB");

    app.listen(8000, () => {
      console.log(" Server running at http://localhost:8000");
    });
  } catch (err) {
    console.error(" MongoDB connection error:", err.message);
    process.exit(1);
  }
}
main();

/* ================= SESSION & PASSPORT ================= */

const sessionOptions = {
  secret: process.env.SESSION_SECRET || "mysupersecretcode",
  resave: false,
  saveUninitialized: true, // works (auth apps usually prefer false)
  cookie: {
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
  },
};



app.use(session(sessionOptions));
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
  next();
});

/* ================= ROUTES ================= */

app.get("/listings", async (req, res) => {
  const allListings = await Listing.find({});
  res.render("listings/index", { allListings });
});

/* ---------- AUTH ---------- */

app.get("/signup", (req, res) => {
  res.render("users/signup.ejs");
});

/*  added `next` */
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
  },
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
    .populate({
      path: "reviews",
      populate: { path: "author" },
    })
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
  }),
);

app.get("/listings/:id/edit", isLoggedIn, isOwner, async (req, res) => {
  const listing = await Listing.findById(req.params.id);
  if (!listing) {
    req.flash("error", "Listing does not exist!");
    return res.redirect("/listings"); //
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
  },
);

app.delete("/listings/:id", isLoggedIn, isOwner, async (req, res) => {
  await Listing.findByIdAndDelete(req.params.id);
  res.redirect("/listings");
});

/* ---------- REVIEWS ---------- */
/*  isLoggedIn BEFORE validateReview */

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
  }),
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
  }),
);

/* ---------- ERROR HANDLING ---------- */

app.use((req, res, next) => {
  next(new ExpressError(404, "Page Not Found"));
});

app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong" } = err;
  res.status(statusCode).render("error.ejs", { err });
});

// console.log("Cloud name:", process.env.CLOUD_NAME);
// console.log("API key:", process.env.CLOUD_API_KEY);
// console.log("Cloudinary secret length:", process.env.CLOUD_API_SECRET?.length);

// if (process.env.NODE_ENV != "production") {
//   require("dotenv").config();
// }
// const express = require("express");
// const app = express();

// const mongoose = require("mongoose");
// const Listing = require("./models/listing.js");
// const path = require("path");
// const ejsMate = require("ejs-mate");
// const methodOverride = require("method-override");
// const wrapAsync = require("./utils/wrapAsync.js");
// const ExpressError = require("./utils/ExpressError.js");
// const multer = require("multer");
// const { storage } = require("./cloudConfig.js");
// const upload = multer({ storage });
// const { listingSchema, reviewSchema } = require("./schema.js");
// const Review = require("./models/review.js");
// const flash = require("connect-flash");
// const session = require("express-session");
// const passport = require("passport");
// const LocalStrategy = require("passport-local");
// const User = require("./models/user.js");
// app.use(express.json());
// const {
//   isLoggedIn,
//   saveRedirectUrl,
//   isOwner,
//   validateListing,
//   validateReview,
//   isReviewAuthor,
// } = require("./middleware.js");

// const dbUrl = process.env.ATLASDB_URL;

// async function main() {
//   try {
//     await mongoose.connect(dbUrl);
//     console.log("✅ Connected to MongoDB");

//     app.listen(8000, () => {
//       console.log("🚀 Server running at http://localhost:8000");
//     });

//   } catch (err) {
//     console.error("❌ MongoDB connection error:", err.message);
//     process.exit(1);
//   }
// }

// main();

// app.set("view engine", "ejs");
// app.use(express.static(path.join(__dirname, "/public")));
// app.engine("ejs", ejsMate);
// app.set("views", path.join(__dirname, "views"));
// app.use(express.urlencoded({ extended: true }));
// app.use(methodOverride("_method"));
// const sessionOptions = {
//   secret: process.env.SESSION_SECRET || "mysupersecretcode",
//   resave: false,
//   saveUninitialized: true,
//   cookie: {
//     expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
//     maxAge: 7 * 24 * 60 * 60 * 1000,
//     httpOnly: true,
//   },
// };
// app.use(session(sessionOptions));
// app.use(flash());
// app.use(passport.initialize());
// app.use(passport.session());
// passport.use(new LocalStrategy(User.authenticate()));
// passport.serializeUser(User.serializeUser());
// passport.deserializeUser(User.deserializeUser());
// app.use((req, res, next) => {
//   res.locals.success = req.flash("success");
//   res.locals.error = req.flash("error");
//   res.locals.currUser = req.user;
//   next();
// });
// // main().catch((err) => console.log(err));
// // //
// app.get("/listings", async (req, res) => {
//   try {
//     const allListings = await Listing.find({});
//     res.render("listings/index", { allListings });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Server error while fetching listings");
//   }
// });
// app.get("/signup", (req, res) => {
//   res.render("users/signup.ejs");
// });
// app.post("/signup", async (req, res) => {
//   try {
//     const { username, email, password } = req.body;

//     const newUser = new User({ email, username });
//     const registeredUser = await User.register(newUser, password);
//     console.log(registeredUser);
//     req.login(registeredUser, (err) => {
//       if (err) {
//         return next(err);
//       }
//       req.flash("success", "Welcome to Wanderlust!");
//       res.redirect("/listings");
//     });
//   } catch (e) {
//     req.flash("error", e.message);
//     res.redirect("/signup");
//   }
// });
// app.get("/login", (req, res) => {
//   res.render("users/login.ejs");
// });
// app.post(
//   "/login",
//   saveRedirectUrl,
//   passport.authenticate("local", {
//     failureRedirect: "/login",
//     failureFlash: true,
//   }),
//   async (req, res) => {
//     req.flash("success", "Welcome back to Wanderlust!");
//     const redirectUrl = res.locals.redirectUrl || "/listings";
//     res.redirect(redirectUrl);
//   },
// );
// app.get("/listing/new", isLoggedIn, (req, res) => {
//   res.render("listings/new.ejs");
// });
// app.get("/listings/:id", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const listing = await Listing.findById(id)
//       .populate({
//         path: "reviews",
//         populate: {
//           path: "author",
//         },
//       })
//       .populate("owner");
//     if (!listing) {
//       req.flash("error", "Listing you requested for does not exist!");
//       return res.redirect("/listings"); // ✅ important: add return
//     }
//     res.render("listings/show.ejs", { listing });
//     console.log(listing);
//   } catch (err) {
//     console.error(err);
//     req.flash("error", "Something went wrong!");
//     res.redirect("/listings");
//   }
// });

// app.post(
//   "/listings",
//   isLoggedIn,
//   validateListing,
//   upload.single("listing[image]"),
//   wrapAsync(async (req, res, next) => {
//     let url = req.file.path;
//     let filename = req.file.filename;
//     const newListing = new Listing(req.body.listing);
//     newListing.owner = req.user._id; // links the logged-in user to the listing
//     newListing.image = { url, filename };
//     await newListing.save();
//     req.flash("success", "New Listing Created!");
//     res.redirect("/listings");
//   }),
// );
// app.get("/logout", (req, res, next) => {
//   req.logout((err) => {
//     if (err) {
//       return next(err);
//     }
//     req.flash("success", "you are logged out");
//     res.redirect("/listings");
//   });
// });
// app.get("/listings/:id/edit", isLoggedIn, isOwner, async (req, res) => {
//   let { id } = req.params;
//   const listing = await Listing.findById(id);
//   if (!listing) {
//     req.flash("error", "Listing you requested for does not exist!");
//     res.redirect("/listings");
//   }
//   res.render("listings/edit.ejs", { listing });
// });

// app.put(
//   "/listings/:id",
//   isLoggedIn,
//   isOwner,
//   upload.single("listing[image]"),
//   validateListing,
//   async (req, res) => {
//     const { id } = req.params;
//     const listing = await Listing.findByIdAndUpdate(id, {
//       ...req.body.listing,
//     });
//     if (typeof req.file !== "undefined") {
//       const url = req.file.path;
//       const filename = req.file.filename;
//       listing.image = { url, filename };
//       await listing.save();
//     }
//     req.flash("success", "Listing Updated");
//     res.redirect(`/listings/${id}`);
//   },
// );
// app.delete("/listings/:id", isLoggedIn, isOwner, async (req, res) => {
//   let { id } = req.params;
//   let deletedListing = await Listing.findByIdAndDelete(id, {
//     ...req.body.listing,
//   });
//   res.redirect("/listings");
// });
// app.post(
//   "/listings/:id/reviews",
//   validateReview,
//   isLoggedIn,
//   wrapAsync(async (req, res) => {
//     const listing = await Listing.findById(req.params.id);
//     const newReview = new Review(req.body.review);
//     newReview.author = req.user._id;
//     listing.reviews.push(newReview);
//     await newReview.save();
//     await listing.save();
//     res.redirect(`/listings/${listing._id}`);
//   }),
// );
// app.delete(
//   "/listings/:id/reviews/:reviewId",
//   isLoggedIn,
//   isReviewAuthor,
//   wrapAsync(async (req, res) => {
//     let { id, reviewId } = req.params;
//     await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
//     await Review.findByIdAndDelete(reviewId);
//     res.redirect(`/listings/${id}`);
//   }),
// );
// app.use((req, res, next) => {
//   const err = new ExpressError(404, "Page Not Found");
//   next(err);
// });
// app.use((err, req, res, next) => {
//   const { statusCode = 500, message = "Something went wrong" } = err;
//   res.status(statusCode).render("error.ejs", { err });
// });

// // mongodb://atlas-sql-69750667cfd9d5c33c2f4e8f-ggz9o6.a.query.mongodb.net/test?ssl=true&authSource=admin
// VciSd6Q4yrQgzviV
