import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Bot, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function ChatInterface() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const repoUrl = params.get("repo") || "Unknown Repository";
  const projectName = repoUrl;
  const messagesEndRef = useRef(null);

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `I've processed the repository at ${repoUrl}. What would you like to know about this codebase?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    console.log(projectName);

    try {
      const response = await fetch("http://localhost:5001/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input, projectName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch response: ${response.status}`);
      }

      // Check if we're getting a stream or JSON
      const contentType = response.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        // Handle JSON response
        const data = await response.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.content || JSON.stringify(data) },
        ]);
      } else {
        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let botMessage = { role: "assistant", content: "" };
        let accumulatedContent = "";

        setMessages((prev) => [...prev, botMessage]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });

          // Process the chunk - clean up potential formatting
          const processedChunk = processChunk(chunk);
          accumulatedContent += processedChunk;

          // Update the message with processed content
          botMessage.content = accumulatedContent;

          setMessages((prev) => {
            const updatedMessages = [...prev];
            updatedMessages[updatedMessages.length - 1] = { ...botMessage };
            return updatedMessages;
          });
        }
      }
    } catch (error) {
      console.error("Error in handleSendMessage:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ Error: ${error.message || "Unable to process request."}`,
        },
      ]);
    }

    setLoading(false);
  };

  // Helper function to process incoming chunks
  const processChunk = (chunk) => {
    // If the chunk contains tokenized format like your paste.txt
    if (chunk.includes('0:"') || chunk.includes("f:{")) {
      try {
        // Extract only the actual content
        const contentMatches = chunk.match(/0:"([^"]*)"/g);
        if (contentMatches) {
          return contentMatches
            .map((match) => match.substring(3, match.length - 1))
            .join("");
        }
      } catch (e) {
        console.warn("Chunk processing error:", e);
      }
    }

    // If we can't process it or it's already clean, return as is
    return chunk;
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="container py-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <Button
          onClick={() => navigate("/")}
          className="font-bold flex items-center p-3 bg-yellow-400 hover:bg-yellow-500 text-black border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
      </div>

      <div className="rounded-xl border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-4 border-b-4 border-black pb-4">
          <h2 className="text-xl md:text-2xl font-black">
            Chat with Repository:{" "}
            <span className="text-cyan-500">{projectName}</span>
          </h2>
        </div>

        <div className="h-[500px] overflow-y-auto mb-6 p-4 border-4 border-black rounded-lg bg-yellow-50">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`mb-4 ${message.role === "user" ? "ml-12" : "mr-12"}`}
            >
              <div
                className={`p-4 rounded-lg border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]
                  ${
                    message.role === "user"
                      ? "bg-yellow-400 ml-auto"
                      : "bg-cyan-100"
                  }`}
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
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSendMessage}
          className="flex flex-col md:flex-row gap-4"
        >
          <Input
            type="text"
            placeholder="Ask something about the codebase..."
            className="flex-1 p-4 border-4 border-black h-14 text-sm md:text-lg font-medium rounded-lg focus-visible:ring-cyan-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <Button
            type="submit"
            className="h-14 flex items-center justify-center p-4 text-lg font-bold bg-cyan-500 hover:bg-cyan-600 text-white border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
            disabled={loading}
          >
            <Send className="h-5 w-5 mr-2" />
            {loading ? "Loading..." : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default ChatInterface;
