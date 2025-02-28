/* eslint-disable no-unused-vars */
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Bot, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

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

    try {
      const response = await fetch("http://localhost:5001/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input, projectName }),
      });
      const jsonResponse = await response.json();
      if (jsonResponse.redirect) {
        toast.error("Your session is expired");
        navigate("/"); // Redirect to home page
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch response: ${response.status}`);
      }

      // Check if the response signals that the Pinecone index was deleted

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

        // Remove any metadata from the accumulated content
        accumulatedContent = removeMetadata(accumulatedContent);

        // Fix newlines and code formatting in the accumulated content
        accumulatedContent = fixCodeFormatting(accumulatedContent);

        // Update the message with processed content
        botMessage.content = accumulatedContent;

        setMessages((prev) => {
          const updatedMessages = [...prev];
          updatedMessages[updatedMessages.length - 1] = { ...botMessage };
          return updatedMessages;
        });
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
    // If the chunk contains tokenized format
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

  // Function to remove metadata from the accumulated content
  const removeMetadata = (content) => {
    // Remove the token usage and finish reason metadata
    let cleaned = content
      // Remove finish reason and token usage
      .replace(
        /\s*e:\{"finishReason":"[^"]*","usage":\{"promptTokens":\d+,"completionTokens":\d+\},"isContinued":(true|false)\}(\s*\})?/g,
        ""
      )
      // Remove message IDs
      .replace(/f:\{"messageId":"[^"]*"\}\s*/g, "")
      // Remove other metadata like d:{...}
      .replace(/d:\{[^}]*\}/g, "");

    // Remove any trailing close brackets that might be left
    cleaned = cleaned.replace(/\s*\}\s*$/, "");

    return cleaned;
  };

  // Comprehensive function to fix code formatting issues
  // Enhance the fixCodeFormatting function with stronger quote processing
  const fixCodeFormatting = (content) => {
    // Replace escaped newlines with actual newlines
    let fixed = content.replace(/\\n/g, "\n").replace(/\\r/g, "");

    // Fix markdown formatting
    fixed = fixed.replace(/\\\*\*/g, "**"); // Fix bold formatting

    // Replace single backslash followed by double quotes with just double quotes
    fixed = fixed.replace(/\\"/g, '"');

    // Replace single backslash followed by single quotes with just single quotes
    fixed = fixed.replace(/\\'/g, "'");

    // Replace the pattern of \groq-sdk\ with 'groq-sdk'
    fixed = fixed.replace(/\\([a-zA-Z0-9_-]+)\\/g, "'$1'");

    // Replace the pattern of \summary\ with 'summary'
    fixed = fixed.replace(/\\([a-zA-Z0-9_-]+)\\/g, "'$1'");

    // Replace the pattern of \user\ with 'user'
    fixed = fixed.replace(/\\([a-zA-Z0-9_-]+)\\/g, "'$1'");

    // Replace any remaining backslash patterns
    fixed = fixed.replace(/\\([a-zA-Z0-9_-]+)\\/g, '"$1"');
    fixed = fixed.replace(/\\\\/g, "\\");

    // Process code blocks with backticks
    const codeBlockRegex = /```[\s\S]*?```/g;
    let match;
    let lastIndex = 0;
    let result = "";

    // Find all code blocks and process them separately
    while ((match = codeBlockRegex.exec(fixed)) !== null) {
      // Add text before the code block
      result += fixed.substring(lastIndex, match.index);

      // Get the code block content
      let codeBlock = match[0];

      // Fix additional backslash patterns in code blocks
      codeBlock = codeBlock
        .replace(/\\([a-zA-Z0-9_-]+)\\/g, '"$1"') // Replace \word\ with "word"
        .replace(/\\"/g, '"') // Replace \" with "
        .replace(/\\'/g, "'") // Replace \' with '
        .replace(/\\\\/g, "\\") // Replace \\ with \
        .replace(/\\([^\\])/g, "$1"); // Replace \X with X where X is not a backslash

      // Add the fixed code block
      result += codeBlock;

      // Update the last index
      lastIndex = match.index + match[0].length;
    }

    // Add any remaining text
    result += fixed.substring(lastIndex);

    // If no code blocks were found, apply fixes to the entire content
    if (result === "") {
      return fixed;
    }

    return result;
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
                {message.role === "user" ? (
                  <p className="font-medium whitespace-pre-line">
                    {message.content}
                  </p>
                ) : (
                  <div className="markdown-content font-medium">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ node, inline, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || "");
                          return !inline && match ? (
                            <div className="my-2">
                              <SyntaxHighlighter
                                style={nord}
                                language={match[1]}
                                PreTag="div"
                                className="border-2 border-black rounded"
                                {...props}
                              >
                                {String(children).replace(/\n$/, "")}
                              </SyntaxHighlighter>
                            </div>
                          ) : (
                            <code
                              className={`${className} bg-gray-200 px-1 py-0.5 rounded`}
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        },
                        // Apply specific styling to list items and paragraphs
                        p({ children }) {
                          return (
                            <p className="my-2 whitespace-pre-line">
                              {children}
                            </p>
                          );
                        },
                        ul({ children }) {
                          return (
                            <ul className="list-disc ml-6 my-2">{children}</ul>
                          );
                        },
                        ol({ children }) {
                          return (
                            <ol className="list-decimal ml-6 my-2">
                              {children}
                            </ol>
                          );
                        },
                        li({ children }) {
                          return <li className="my-1">{children}</li>;
                        },
                        h1({ children }) {
                          return (
                            <h1 className="text-xl font-bold my-3">
                              {children}
                            </h1>
                          );
                        },
                        h2({ children }) {
                          return (
                            <h2 className="text-lg font-bold my-2">
                              {children}
                            </h2>
                          );
                        },
                        h3({ children }) {
                          return (
                            <h3 className="text-md font-bold my-2">
                              {children}
                            </h3>
                          );
                        },
                        a({ children, href }) {
                          return (
                            <a
                              href={href}
                              className="text-blue-600 underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          );
                        },
                        blockquote({ children }) {
                          return (
                            <blockquote className="border-l-4 border-gray-400 pl-4 italic my-2">
                              {children}
                            </blockquote>
                          );
                        },
                        table({ children }) {
                          return (
                            <div className="overflow-x-auto my-4">
                              <table className="border-collapse border border-gray-300 w-full">
                                {children}
                              </table>
                            </div>
                          );
                        },
                        thead({ children }) {
                          return (
                            <thead className="bg-gray-100">{children}</thead>
                          );
                        },
                        tbody({ children }) {
                          return <tbody>{children}</tbody>;
                        },
                        tr({ children }) {
                          return (
                            <tr className="border-b border-gray-300">
                              {children}
                            </tr>
                          );
                        },
                        th({ children }) {
                          return (
                            <th className="border border-gray-300 px-4 py-2 text-left">
                              {children}
                            </th>
                          );
                        },
                        td({ children }) {
                          return (
                            <td className="border border-gray-300 px-4 py-2">
                              {children}
                            </td>
                          );
                        },
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
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
