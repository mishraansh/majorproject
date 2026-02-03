
const mongoose = require("mongoose")
const initData = require("./data.js")
const User = require("../models/user.js");
const Listing = require("../models/listing.js");
main().then(() => {
    console.log("connected to DB")
})
.catch(err => {
     console.log(err)
});
async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/wanderlust');
  console.log("Connected to MongoDB");
}
const initDB = async ()=> {
  await Listing.deleteMany({});

  const ownerId = "672ab13e45eac3f3c8ab89d5"; // Replace with a valid user _id from your Users collection

  initData.data = initData.data.map((obj) => ({
    ...obj,
    owner: ownerId
  }));

  await Listing.insertMany(initData.data);
  console.log("✅ Data initialized successfully!");
};
initDB();
