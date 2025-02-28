import express from "express";
import cors from "cors";

import { config } from "dotenv";
import router from "./routes.js";
config();

PORT = process.env.PORT || 5001;

const app = express();
app.use(
  cors({
    origin: "*",
  })
);
app.use(express.json());

app.use("/api", router);

app.listen(PORT, () => console.log("✅ Server running on port 5001"));
