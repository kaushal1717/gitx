import { useState } from "react";
import { ArrowLeft, Send, Bot, User, Loader2 } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function ChatInterface() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const repoUrl = params.get("repo") || "Unknown Repository";

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `I've processed the repository at ${repoUrl}. What would you like to know about this codebase?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false); // For the typing animation

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add the user's message
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    setInput("");
    setLoading(true); // Show typing indicator

    setTimeout(() => {
      const responses = [
        "This codebase uses a React frontend with a Node.js backend.",
        "The authentication system uses JWT tokens stored in HTTP-only cookies.",
        "There are approximately 15,000 lines of code across 120 files.",
        "The project uses TypeScript and has 85% test coverage with Jest.",
        "The database interactions use Prisma ORM with PostgreSQL.",
      ];

      // Add AI response after 1 second delay
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: responses[Math.floor(Math.random() * responses.length)],
        },
      ]);
      setLoading(false); // Hide typing indicator
    }, 1000);
  };

  return (
    <div className="container py-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <Button
          onClick={() => navigate("/")}
          className="font-bold bg-yellow-400 flex p-4 hover:bg-yellow-500 text-black border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </div>

      <div className="rounded-xl border-4 border-black bg-white p-6">
        <h2 className="text-2xl font-black">
          Chat with Repository:{" "}
          <span className="text-cyan-500">
            {repoUrl.replace("https://github.com/", "")}
          </span>
        </h2>
        <div className="h-[500px] overflow-y-auto mb-6 p-4 border-4 border-black rounded-lg bg-yellow-50">
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className={`mb-4 ${message.role === "user" ? "ml-12" : "mr-12"}`}
            >
              <div
                className={`
                  p-4 rounded-lg border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]
                  ${
                    message.role === "user"
                      ? "bg-yellow-400 ml-auto"
                      : "bg-cyan-100"
                  }
                `}
              >
                <div className="flex items-center mb-2">
                  {message.role === "assistant" ? (
                    <Bot className="h-6 w-6 mr-2 text-cyan-500" />
                  ) : (
                    <User className="h-6 w-6 mr-2 text-yellow-600" />
                  )}
                  <span className="font-bold">
                    {message.role === "assistant" ? "GitX Assistant" : "You"}
                  </span>
                </div>
                <p className="font-medium">{message.content}</p>
              </div>
            </motion.div>
          ))}

          {/* Typing Indicator */}
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: 0.5,
                repeat: Infinity,
                repeatType: "reverse",
              }}
              className="ml-12 flex items-center space-x-2 text-black font-bold"
            >
              <Bot className="h-5 w-5 text-cyan-500 animate-bounce" />
              <p>Typing...</p>
            </motion.div>
          )}
        </div>

        {/* Input Field */}
        <form onSubmit={handleSendMessage} className="flex gap-4">
          <Input
            type="text"
            placeholder="Ask something about the codebase..."
            className="flex-1 px-4 border-4 border-black h-14 text-lg font-medium rounded-lg focus-visible:ring-cyan-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button
            type="submit"
            className="h-14 px-8 text-lg flex p-4 font-bold bg-cyan-500 hover:bg-cyan-600 text-white border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
            disabled={loading} // Disable button while waiting for response
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5 mr-2" />
            )}
            {loading ? "Sending..." : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default ChatInterface;
