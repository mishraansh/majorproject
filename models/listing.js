const mongoose = require("mongoose");
const Schema = mongoose.Schema; // ✅ extract Schema
const Review = require("./review.js")

const listingSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  image: {
    filename: String,
    url: String,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  location: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  reviews: [
    {
      type: Schema.Types.ObjectId,
      ref: "Review", // ✅ reference matches your review model
    },
  ],
  owner : {
    type:  mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});
listingSchema.post("findOneAndDelete",  async (listing) =>{
  if(listing) {
     await Review.deleteMany({_id : {$in : listing.reviews}})
  }
})
const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;































// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;


// const listingSchema = new Schema({
//     title:{ 
//         type:String
//     },
//     description:String,

//     image:{
//         type:String,
//         default:
//             "https://www.shutterstock.com/image-photo/dusk-themed-photo-editorial-tone-strong-2618136655",
//         set: (v) =>
//              v === "" 
//         ? "https://www.shutterstock.com/image-photo/dusk-themed-photo-editorial-tone-strong-2618136655"
//         :v,
//     },
//     price:Number,
//     location:String,
//     country: String,
// });


// const Listing = mongoose.model("Listing", listingSchema);
// module.exports  = Listing;