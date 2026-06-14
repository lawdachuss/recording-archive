// Diagnostic handler — replace with real Express app once confirmed working
export default function handler(req, res) {
  const data = {
    status: "ok",
    message: "Vercel serverless function works",
    timestamp: new Date().toISOString(),
    url: req.url,
    method: req.method,
  };
  res.status(200).json(data);
}
