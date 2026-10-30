import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);



import express from 'express'
import { MongoClient } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';


const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); 
app.use(express.json()); 

// Database config

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let db;

export async function connectToMongoDB() {
  try {
    await client.connect();
    // Initialize the 'db' variable with your specific database name
    db = client.db('roadnest'); 
    console.log("🚀 You successfully connected to MongoDB!");
    return db; 
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1); // Stop the server if the DB fails to connect
  }
}





app.get('/', (req, res) => {
    res.send('Server is Running')
})







async function startServer() {
    await connectToMongoDB(); // 1. Connect to DB
    app.listen(PORT, () => {   // 2. Then start server
        console.log(`✅ Server is running on port ${PORT}`);
    });
}

startServer();












app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})

