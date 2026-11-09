// import dns from "node:dns";
// dns.setServers(["8.8.8.8", "1.1.1.1"]);

// import express from "express";
// import cors from "cors";
// import { MongoClient, ObjectId } from "mongodb";
// import "dotenv/config";

// const app = express();
// const PORT = process.env.PORT || 5000;

// app.use(cors());
// app.use(express.json());

// const client = new MongoClient(process.env.MONGO_URI);

// async function startServer() {
//   try {
//     await client.connect();
//     const db = client.db("roadnest");
//     const carCollection = db.collection("cars");
//     console.log("🚀 You successfully connected to MongoDB!");

//     app.get("/", (req, res) => {
//       res.send("Server is Running");
//     });

//     // add a car
//     app.post("/cars", async (req, res) => {
//       try {
//         const addedCar = { ...req.body, createdAt: new Date() };
//         console.log(addedCar);
//         const result = await carCollection.insertOne(addedCar);
//         res.status(201).send(result);
//       } catch (err) {
//         console.error(err);
//         res.status(500).send({ message: "Failed to add car" });
//       }
//     });


//     // get all cars

//     app.get("/cars", async (req, res) => {
//       try {
//         const cars = await carCollection.find().toArray();
//         res.send(cars);
//       } catch (err) {
//         console.error(err);
//         res.status(500).send({ message: "Failed to get cars" });
//       }
//     })

//     // car details page

//     app.get("/cars/:id", async (req, res) => {
//     try {
//       const car = await carCollection.findOne({ _id: new ObjectId(req.params.id) });
//       if (!car) return res.status(404).send({ message: "Car not found" });
//       res.send(car);
//     } catch (err) {
//       res.status(400).send({ message: "Invalid car id" });
//     }
//   });

//     // edit car details

//     app.patch("/cars/:id", async (req, res) => {
//         try {
//             const { _id, ...updates } = req.body; // never try to overwrite _id
//             const result = await carCollection.updateOne(
//                 { _id: new ObjectId(req.params.id) },
//                 { $set: updates }
//             );
//             res.send(result);
//         } catch (err) {
//           console.error(err);
//           res.status(500).send({ message: "Failed to update car" });
//         }
//     });


//     // Delete Car from Website

//     app.delete("/cars/:id", async (req, res) => {
//       try {
//         const result = await carCollection.deleteOne({
//           _id: new ObjectId(req.params.id),
//         });
//         res.send(result);
//       } catch (err) {
//         console.error(err);
//         res.status(500).send({ message: "Failed to delete car" });
//       }
//     })

    
    





//     app.listen(PORT, () => {
//       console.log(`✅ Server is running on port ${PORT}`);
//     });
//   } catch (err) {
//     console.error("❌ MongoDB Connection Error:", err);
//     process.exit(1);
//   }
// }

// startServer();

import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);

async function startServer() {
  try {
    await client.connect();
    const db = client.db("roadnest");
    const carCollection = db.collection("cars");
    console.log("🚀 You successfully connected to MongoDB!");

    app.get("/", (req, res) => {
      res.send("Server is Running");
    });

    // add a car
    app.post("/cars", async (req, res) => {
      try {
        const addedCar = { ...req.body, createdAt: new Date() };
        console.log(addedCar);
        const result = await carCollection.insertOne(addedCar);
        res.status(201).send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to add car" });
      }
    });

    // get all cars
    app.get("/cars", async (req, res) => {
      try {
        const cars = await carCollection.find().toArray();
        res.send(cars);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to get cars" });
      }
    });

    // get cars added by one user
    app.get("/my-cars", async (req, res) => {
      try {
        const { ownerId } = req.query;

        // must be a plain string. Blocks ?ownerId[$ne]=x tricks that would return every car.
        if (typeof ownerId !== "string" || !ownerId) {
          return res.status(400).send({ message: "ownerId is required" });
        }

        const cars = await carCollection
          .find({ ownerId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(cars);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to get your cars" });
      }
    });

    // car details page
    app.get("/cars/:id", async (req, res) => {
      try {
        const car = await carCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!car) return res.status(404).send({ message: "Car not found" });
        res.send(car);
      } catch (err) {
        res.status(400).send({ message: "Invalid car id" });
      }
    });

    // edit car details
    app.patch("/cars/:id", async (req, res) => {
      try {
        const { _id, ...updates } = req.body; // never try to overwrite _id
        const result = await carCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updates }
        );
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update car" });
      }
    });

    // Delete Car from Website
    app.delete("/cars/:id", async (req, res) => {
      try {
        const result = await carCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to delete car" });
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