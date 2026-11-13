


import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);

/* ---------- booking helpers ---------- */
const MAX_DAYS = 7;
const DAY_MS = 86400000;
const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000; // renter: free cancellation 24h after booking
const OWNER_CANCEL_WINDOW_MS = 5 * 60 * 60 * 1000; // owner: can cancel a ride 5h after booking
const COMMISSION = 0.1; // the platform keeps 10% of every order
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Dates are plain "YYYY-MM-DD" strings, so no time zone bugs and string compare works.
const todayKey = () => new Date().toISOString().slice(0, 10);

function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

const keyFromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

function isRealDate(key) {
  if (typeof key !== "string" || !DATE_RE.test(key)) return false;
  return keyFromDayNumber(dayNumber(key)) === key; // rejects Feb 30 etc.
}

const cents = (n) => Math.round(n * 100) / 100;

function money(total) {
  const platformFee = cents(total * COMMISSION);
  return { platformFee, ownerEarning: cents(total - platformFee) };
}

// old bookings have no fee fields, so work them out on the fly
const withMoney = (booking) => {
  if (
    typeof booking.platformFee === "number" &&
    typeof booking.ownerEarning === "number"
  ) {
    return booking;
  }
  return { ...booking, ...money(Number(booking.totalPrice) || 0) };
};

// Delivery window = pick-up day + the day after.
// The server allows one day of slack on each side, so every time zone works.
function deliveryWindow(startDate) {
  const today = dayNumber(todayKey());
  const start = dayNumber(startDate);
  if (today < start - 1) return "before";
  if (today > start + 2) return "closed";
  return "open";
}

// bookings that have not finished yet
const activeFilter = (extra = {}) => ({
  ...extra,
  endDate: { $gte: todayKey() },
});
const rangeFields = { projection: { _id: 0, carId: 1, startDate: 1, endDate: 1 } };

async function startServer() {
  try {
    await client.connect();
    const db = client.db("roadnest");
    const carCollection = db.collection("cars");
    const bookingCollection = db.collection("bookings");
    // rides cancelled by the owner. The booking itself is deleted from `bookings`,
    // this notice (without `dates`) keeps the renter's card on screen.
    const cancelledCollection = db.collection("cancelledBookings");

    // One document per booking holds every booked day in `dates`.
    // This unique index makes double booking impossible, even for two simultaneous requests.
    await bookingCollection.createIndex({ carId: 1, dates: 1 }, { unique: true });

    // does this user own the car behind the booking?
    async function ownsBooking(booking, userId) {
      if (booking.ownerId) return booking.ownerId === userId;
      // old bookings have no ownerId: look at the car
      if (!ObjectId.isValid(booking.carId)) return false;
      const car = await carCollection.findOne(
        { _id: new ObjectId(booking.carId) },
        { projection: { ownerId: 1 } }
      );
      return car?.ownerId === userId;
    }

    console.log("🚀 You successfully connected to MongoDB!");

    app.get("/", (req, res) => {
      res.send("Server is Running");
    });

    // JWKS
    const JWKS = createRemoteJWKSet(
      new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
    )



    
    // verify token
        async function verifyToken(req, res, next) {
          const authHeader = req.headers.authorization;

          if (!authHeader) {
            return res.status(401).send({
              message: "Access Denied",
            });
          }

          const [scheme, token] = authHeader.split(" ");

          if (scheme !== "Bearer" || !token) {
            return res.status(401).send({
              message: "Invalid authorization header",
            });
          }

          try {
            const { payload } = await jwtVerify(token, JWKS);

            const userId = payload.sub || payload.id;

            if (typeof userId !== "string" || !userId) {
              return res.status(401).send({
                message: "Invalid user token",
              });
            }

            req.user = { id: userId };

            next();

          } catch (err) {
            return res.status(401).send({
              message: "Invalid or expired token",
            });
          }
       }


            // Guests allowed. If a token is sent it must be valid, otherwise 401.
      async function optionalToken(req, res, next) {
        const authHeader = req.headers.authorization;

        // no token = guest, continue without req.user
        if (!authHeader) return next();

        const [scheme, token] = authHeader.split(" ");
        if (scheme !== "Bearer" || !token) {
          return res.status(401).send({ message: "Invalid authorization header" });
        }

        try {
          const { payload } = await jwtVerify(token, JWKS);
          const userId = payload.sub || payload.id;
          if (typeof userId === "string" && userId) {
            req.user = { id: userId };
          }
          next();
        } catch (err) {
          return res.status(401).send({ message: "Invalid or expired token" });
        }
      }
    
   

    // add a car
    
    app.post("/cars", verifyToken, async (req, res) => {
      try {
        const addedCar = {
          ...req.body,
          ownerId: req.user.id,
          createdAt: new Date(),
        };

        const result = await carCollection.insertOne(addedCar);

        res.status(201).send(result);
      } catch (err) {
        console.error(err);

        res.status(500).send({
          message: "Failed to add car",
        });
      }
    });


    // stops users from injecting regex symbols into a search
     const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // get all cars, newest first (each car carries its upcoming booked date ranges)
    // app.get("/cars", async (req, res) => {
    //   try {
    //     const cars = await carCollection
    //       .find()
    //       .sort({ createdAt: -1, _id: -1 })
    //       .toArray();
    //     const ranges = await bookingCollection
    //       .find(activeFilter(), rangeFields)
    //       .sort({ startDate: 1 })
    //       .toArray();

    //     const byCar = {};
    //     for (const r of ranges) {
    //       (byCar[r.carId] ||= []).push({
    //         startDate: r.startDate,
    //         endDate: r.endDate,
    //       });
    //     }

    //     res.send(
    //       cars.map((car) => ({ ...car, bookedRanges: byCar[String(car._id)] || [] }))
    //     );
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send({ message: "Failed to get cars" });
    //   }
    // });


    app.get("/cars", async (req, res) => {
      try {
        const { search, type, limit: rawLimit } = req.query;

        const filter = {};

        // Search car names using MongoDB regex
        if (typeof search === "string" && search.trim()) {
          const safeSearch = escapeRegex(search.trim().slice(0, 100));

          filter.name = {
            $regex: safeSearch,
            $options: "i",
          };
        }

    // Filter car categories using MongoDB $in
        if (typeof type === "string" && type.trim() && type !== "All Types") {
          const selectedTypes = type
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

          if (selectedTypes.length) {
            filter.type = {
              $in: selectedTypes,
            };
          }
        }

        let cursor = carCollection
          .find(filter)
          .sort({ createdAt: -1, _id: -1 });

        // Optional limit for autocomplete suggestions
        if (rawLimit !== undefined) {
          const limit = Number(rawLimit);

          if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
            return res.status(400).send({
              message: "Invalid result limit.",
            });
          }

          cursor = cursor.limit(limit);
        }

        const cars = await cursor.toArray();

        // Only retrieve booking ranges for the matching cars
        const carIds = cars.map((car) => String(car._id));

        const ranges = carIds.length
          ? await bookingCollection
              .find(
                activeFilter({ carId: { $in: carIds } }),
                rangeFields
              )
              .sort({ startDate: 1 })
              .toArray()
          : [];

        const byCar = {};

        for (const range of ranges) {
          (byCar[range.carId] ||= []).push({
            startDate: range.startDate,
            endDate: range.endDate,
          });
        }

        res.send(
          cars.map((car) => ({
            ...car,
            bookedRanges: byCar[String(car._id)] || [],
          }))
        );
      } catch (err) {
        console.error("Car search error:", err);

        res.status(500).send({
          message: "Failed to get cars.",
        });
      }
    });


    // get cars added by one user
    app.get("/my-cars", verifyToken, async (req, res) => {
      try {
        const ownerId = req.user.id;

        const cars = await carCollection
          .find({ ownerId })
          .sort({ createdAt: -1, _id: -1 })
          .toArray();

        res.send(cars);
      } catch (err) {
        console.error(err);

        res.status(500).send({
          message: "Failed to get your cars",
      });
    }
  });

    // middleware


    // car details page (with upcoming booked date ranges)
    app.get("/cars/:id", optionalToken,  async (req, res) => {
      try {
        const car = await carCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!car) return res.status(404).send({ message: "Car not found" });

        const bookedRanges = await bookingCollection
          .find(activeFilter({ carId: String(car._id) }), rangeFields)
          .sort({ startDate: 1 })
          .toArray();

        res.send({
          ...car,
          bookedRanges: bookedRanges.map((r) => ({
            startDate: r.startDate,
            endDate: r.endDate,
          })),
        });
      } catch (err) {
        res.status(400).send({ message: "Invalid car id" });
      }
    });

    // edit car details: owner only
    app.patch("/cars/:id", verifyToken, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid car id" });
        }

        const carId = new ObjectId(req.params.id);
        const car = await carCollection.findOne(
          { _id: carId },
          { projection: { ownerId: 1 } }
        );
        if (!car) return res.status(404).send({ message: "Car not found" });

        // only the owner. Cars with no ownerId can't be edited by anyone.
        if (!car.ownerId || car.ownerId !== req.user.id) {
          return res
            .status(403)
            .send({ message: "You can only edit your own cars." });
        }

        // only these fields can change. ownerId, createdAt etc. are never touched.
        const body = req.body || {};
        const updates = {};

        for (const key of ["name", "type", "imageUrl", "location", "description"]) {
          if (body[key] !== undefined) {
            if (typeof body[key] !== "string" || !body[key].trim()) {
              return res.status(400).send({ message: `Invalid ${key}.` });
            }
            updates[key] = body[key].trim();
          }
        }

        for (const key of ["pricePerDay", "seats"]) {
          if (body[key] !== undefined) {
            const value = Number(body[key]);
            if (!Number.isFinite(value) || value < 1) {
              return res.status(400).send({ message: `Invalid ${key}.` });
            }
            updates[key] = value;
          }
        }

        if (body.status !== undefined) {
          if (!["available", "unavailable", "maintenance"].includes(body.status)) {
            return res.status(400).send({ message: "Invalid status." });
          }
          updates.status = body.status;
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).send({ message: "Nothing to update." });
        }

        // ownerId is in the filter too, so the check holds even under a race
        const result = await carCollection.updateOne(
          { _id: carId, ownerId: req.user.id },
          { $set: updates }
        );
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update car" });
      }
    });

    // Delete Car from Website: owner only
    app.delete("/cars/:id", verifyToken, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid car id" });
        }

        const carId = new ObjectId(req.params.id);
        const car = await carCollection.findOne(
          { _id: carId },
          { projection: { ownerId: 1 } }
        );
        if (!car) return res.status(404).send({ message: "Car not found" });

        // only the owner. Cars with no ownerId can't be deleted by anyone.
        if (!car.ownerId || car.ownerId !== req.user.id) {
          return res
            .status(403)
            .send({ message: "You can only delete your own cars." });
        }

        const result = await carCollection.deleteOne({
          _id: carId,
          ownerId: req.user.id,
        });

        if (result.deletedCount === 1) {
          // Renters keep their booking card, now marked "Car removed from service".
          // GET /orders skips carRemoved bookings, so the owner's orders disappear.
          await bookingCollection.updateMany(
            { carId: String(carId) },
            { $set: { carRemoved: true, carRemovedAt: new Date() } }
          );
        }

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to delete car" });
      }
    });


    

    // book a car
    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const {
          carId,
          startDate,
          endDate,
          driverNeeded,
          specialNote,
          userName,
          userEmail,
          userImage,
        } = req.body;
        const userId = req.user.id;
        

        if (typeof userId !== "string" || !userId) {
          return res.status(400).send({ message: "Please log in to book a car." });
        }
        if (typeof carId !== "string" || !ObjectId.isValid(carId)) {
          return res.status(400).send({ message: "Invalid car id." });
        }
        if (!isRealDate(startDate) || !isRealDate(endDate)) {
          return res.status(400).send({ message: "Please pick valid dates." });
        }

        const start = dayNumber(startDate);
        const end = dayNumber(endDate);
        const days = end - start + 1;

        if (days < 1) {
          return res.status(400).send({ message: "Drop-off can’t be before pick-up." });
        }
        if (days > MAX_DAYS) {
          return res
            .status(400)
            .send({ message: `You can book a car for up to ${MAX_DAYS} days.` });
        }
        // The calendar enforces "starts tomorrow or later".
        // The server only blocks past dates, so users in any time zone are safe.
        if (startDate < todayKey()) {
          return res.status(400).send({ message: "Pick-up date can’t be in the past." });
        }

        // price, name and photo come from the database, never from the browser
        const car = await carCollection.findOne({ _id: new ObjectId(carId) });
        if (!car) return res.status(404).send({ message: "Car not found." });
        if (car.status && car.status !== "available") {
          return res
            .status(409)
            .send({ message: "This car is not available for booking." });
        }
        // owners can’t book their own car.
        if (car.ownerId && car.ownerId === userId) {
          return res.status(403).send({ message: "You can’t book your own car." });
        }

        const dates = [];
        for (let n = start; n <= end; n++) dates.push(keyFromDayNumber(n));

        const pricePerDay = Number(car.pricePerDay) || 0;
        const totalPrice = cents(days * pricePerDay);
        const { platformFee, ownerEarning } = money(totalPrice);

        const booking = {
          carId,
          carName: car.name,
          carImage: car.imageUrl || "",
          carType: car.type || "",
          carLocation: car.location || "",
          pricePerDay,
          startDate,
          endDate,
          dates,
          days,
          totalPrice,
          commissionRate: COMMISSION,
          platformFee,
          ownerEarning,
          ownerId: car.ownerId || "",
          ownerName: car.ownerName || "",
          driverNeeded: driverNeeded === "Yes" ? "Yes" : "No",
          specialNote:
            typeof specialNote === "string" ? specialNote.trim().slice(0, 500) : "",
          userId,
          userName: String(userName || ""),
          userEmail: String(userEmail || ""),
          userImage: String(userImage || ""),
          status: "confirmed",
          deliveredAt: null,
          receivedAt: null,
          createdAt: new Date(),
        };

        const result = await bookingCollection.insertOne(booking);
        res.status(201).send(result);
      } catch (err) {
        if (err.code === 11000) {
          return res.status(409).send({
            message:
              "Those dates are already booked. Please pick other dates.",
          });
        }
        console.error(err);
        res.status(500).send({ message: "Failed to book the car" });
      }
    });

    // get bookings of one user
    app.get("/bookings", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

   
        if (typeof userId !== "string" || !userId) {
          return res.status(400).send({ message: "userId is required" });
        }

        const bookings = await bookingCollection
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(bookings);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to get your bookings" });
      }
    });

    // rides the owner cancelled: the renter's cards that stay on screen
    app.get("/cancelled-bookings", verifyToken, async (req, res) => {
      try {
        const notices = await cancelledCollection
          .find({ userId: req.user.id })
          .sort({ cancelledAt: -1 })
          .toArray();
        res.send(notices);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to get cancelled rides" });
      }
    });

    // renter removes a "canceled by owner" card
    app.delete("/cancelled-bookings/:id", verifyToken, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid id" });
        }

        const result = await cancelledCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          userId: req.user.id,
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Notice not found" });
        }
        res.send({ deleted: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to remove the card" });
      }
    });

    // cancel a booking: only its owner, only within 24h after booking.
    // The booking document holds the booked days, so deleting it frees the dates.
    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        if (typeof userId !== "string" || !userId) {
          return res.status(400).send({ message: "userId is required" });
        }
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(req.params.id),
          userId,
        });
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // car was removed from service: the renter can always clear the card
        if (booking.carRemoved) {
          await bookingCollection.deleteOne({ _id: booking._id });
          return res.send({ deleted: true });
        }

        if (booking.deliveredAt) {
          return res.status(403).send({
            message: "The car was already delivered, so this booking can’t be cancelled.",
          });
        }

        const age = Date.now() - new Date(booking.createdAt).getTime();
        if (age > CANCEL_WINDOW_MS) {
          return res.status(403).send({
            message: "Free cancellation ended 24 hours after booking.",
          });
        }

        await bookingCollection.deleteOne({ _id: booking._id });
        res.send({ deleted: true });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to cancel the booking" });
      }
    });

    // rate a finished ride (1 to 5)
    app.patch("/bookings/:id/rating", verifyToken, async (req, res) => {
      try {
        const { rating } = req.body;
        const userId = req.user.id;
        const value = Number(rating);

        if (typeof userId !== "string" || !userId) {
          return res.status(400).send({ message: "userId is required" });
        }
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          return res.status(400).send({ message: "Rating must be 1 to 5." });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(req.params.id),
          userId,
        });
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        
        if (booking.endDate > todayKey()) {
          return res
            .status(409)
            .send({ message: "You can rate after the ride is completed." });
        }

        await bookingCollection.updateOne(
          { _id: booking._id },
          { $set: { rating: value, ratedAt: new Date() } }
        );
        res.send({ rating: value });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to save your rating" });
      }
    });

    // renter confirms "Received?" after the owner marked the car delivered
    app.patch("/bookings/:id/received", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        if (typeof userId !== "string" || !userId) {
          return res.status(400).send({ message: "userId is required" });
        }
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(req.params.id),
          userId,
        });
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }
        if (!booking.deliveredAt) {
          return res.status(409).send({
            message: "The owner hasn’t marked this car as delivered yet.",
          });
        }
        if (booking.receivedAt) {
          return res
            .status(409)
            .send({ message: "You already confirmed this delivery." });
        }

        const win = deliveryWindow(booking.startDate);
        if (win === "before") {
          return res.status(409).send({
            message: "You can confirm from the pick-up day.",
          });
        }
        if (win === "closed") {
          return res
            .status(409)
            .send({ message: "The confirmation window has ended." });
        }

        const receivedAt = new Date();
        await bookingCollection.updateOne(
          { _id: booking._id },
          { $set: { receivedAt } }
        );
        res.send({ receivedAt });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to confirm the delivery" });
      }
    });

    // orders: bookings made on the cars one user owns
    
    app.get("/orders", verifyToken, async (req, res) => {
      try {
        const ownerId = req.user.id;

    // Find cars belonging to the authenticated owner
        const myCars = await carCollection
          .find({ ownerId }, { projection: { _id: 1 } })
          .toArray();

        const carIds = myCars.map((car) => String(car._id));

    // Orders of removed cars are skipped, so they disappear for the owner
        const mine = {
          $or: [
            { ownerId },
            { carId: { $in: carIds } },
          ],
          carRemoved: { $ne: true },
        };

    // Update only this owner's expired orders
        await bookingCollection.updateMany(
          {
            ...mine,
            endDate: { $lt: todayKey() },
            status: { $ne: "completed" },
          },
          {
              $set: {
              status: "completed",
              completedAt: new Date(),
            },
          }
        );

        const orders = await bookingCollection
          .find(mine)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(orders.map(withMoney));
      } catch (err) {
        console.error("Orders error:", err);

        res.status(500).send({
          message: "Failed to get your orders",
        });
      }
    });


    
    
    // Owner presses "Car Delivered"
    
    app.patch("/orders/:id/deliver", verifyToken, async (req, res) => {
      try {
        // Identify owner using verified JWT
        const ownerId = req.user.id;

        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({
            message: "Invalid order id",
          });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        // Verify that this order belongs to the authenticated owner
        if (!booking || booking.carRemoved || !(await ownsBooking(booking, ownerId))) {
          return res.status(404).send({
            message: "Order not found",
          });
        }

        if (booking.deliveredAt) {
          return res.status(409).send({
            message: "Already marked as delivered.",
          });
        }

        const win = deliveryWindow(booking.startDate);

        if (win === "before") {
          return res.status(409).send({
            message: "You can mark the car as delivered from the pick-up day.",
          });
        }

        if (win === "closed") {
          return res.status(409).send({
            message: "The delivery window has ended.",
          });
        }

        const deliveredAt = new Date();

        const result = await bookingCollection.updateOne(
          {
            _id: booking._id,
            deliveredAt: null,
          },
          {
            $set: { deliveredAt },
          }
        );

        if (!result.modifiedCount) {
          return res.status(409).send({
            message: "Already marked as delivered.",
          });
        }

        res.send({ deliveredAt });

      } catch (err) {
        console.error("Delivery error:", err);

        res.status(500).send({
          message: "Failed to mark the car as delivered",
        });
      }
    });

    // Owner cancels a ride: only the car's owner, only within 5h after it was booked,
    // and only before delivery.
    app.delete("/orders/:id", verifyToken, async (req, res) => {
      try {
        const ownerId = req.user.id;

        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!booking || booking.carRemoved || !(await ownsBooking(booking, ownerId))) {
          return res.status(404).send({ message: "Order not found" });
        }

        if (booking.deliveredAt) {
          return res.status(403).send({
            message: "The car was already delivered, so this ride can’t be cancelled.",
          });
        }

        const bookedAt = new Date(booking.createdAt).getTime();
        if (!Number.isFinite(bookedAt) || Date.now() - bookedAt > OWNER_CANCEL_WINDOW_MS) {
          return res.status(403).send({
            message: "You can only cancel a ride within 5 hours after it was booked.",
          });
        }

        // delete the booking: the dates are free for everyone again
        const result = await bookingCollection.deleteOne({
          _id: booking._id,
          deliveredAt: null,
        });
        if (result.deletedCount === 0) {
          return res
            .status(409)
            .send({ message: "This order just changed. Please refresh the page." });
        }

        // keep a notice (no `dates`) so the renter's card stays: "Ride canceled by owner"
        const { dates, ...notice } = booking;
        try {
          await cancelledCollection.insertOne({
            ...notice,
            cancelledBy: "owner",
            cancelledAt: new Date(),
          });
        } catch (err) {
          console.error("Cancel notice failed:", err);
        }

        res.send({ deleted: true });
      } catch (err) {
        console.error("Owner cancel error:", err);
        res.status(500).send({ message: "Failed to cancel the ride" });
      }
    });



    app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  }
}

startServer();