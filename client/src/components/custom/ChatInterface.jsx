import { useEffect, useRef } from "react";
import { ArrowLeft, Send, Bot, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Download } from "lucide-react";
import { toast } from "sonner";

function ChatInterface() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const repoUrl = params.get("repo") || "Unknown Repository";
  const projectName = repoUrl.split("#")[1];

  const userName = repoUrl.split("#")[0];
  const messagesEndRef = useRef(null);

  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: `${import.meta.env.VITE_BACKEND_URL}/api/query`,
    experimental_prepareRequestBody: () => {
      return {
        query: input,
        projectName,
      };
    },
    onResponse: (response) => {
      if (response.status === 307) {
        toast.error("Session Expired");
        navigate("/");
      }
    },
  });

  const handleSubmitWrapper = (event) => {
    event.preventDefault();
    if (!input.trim()) return;
    handleSubmit({
      body: {
        projectName,
        query: input,
      },
    });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileDownload = async () => {
    try {
      const response = await fetch(
        `${
          import.meta.env.VITE_BACKEND_URL
        }/api/get-url?fileName=${encodeURIComponent(
          `${userName}-${projectName}-output.txt`
        )}`
      );

      if (!response.ok) {
        if (response.status === 400) {
          toast.error("Session Expired");
          navigate("/");
        } else {
          toast.error("Error Downloading File");
        }
        return;
      }

      const { url } = await response.json();

      window.location.href = url;
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Error downloading file");
    }
  };

  return (
    <div className="container py-8 max-w-4xl mx-auto">
      <div className="mb-6 flex gap-4">
        <Button
          onClick={() => navigate("/")}
          className="font-bold flex items-center p-3 bg-yellow-400 hover:bg-yellow-500 text-black border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>
        <Button
          onClick={handleFileDownload}
          className="font-bold flex items-center p-3 bg-green-400 hover:bg-green-500 text-black border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
        >
          <Download className="h-4 w-4" />
          Download llm txt
        </Button>
      </div>

      <div className="rounded-xl border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-4 border-b-4 border-black pb-4">
          <h2 className="text-xl md:text-2xl font-black">
            Chat with Repository:{" "}
            <span className="text-cyan-500">{projectName}</span>
          </h2>
        </div>

        {/* Chat Message Container */}
        <div className="h-[500px] overflow-y-auto mb-6 p-4 border-4 border-black rounded-lg bg-yellow-50">
          {/* Initial AI Message */}
          <div className="mb-4 mr-12">
            <div className="p-4 rounded-lg border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-cyan-100">
              <div className="flex items-center mb-2">
                <Bot className="h-6 w-6 mr-2 text-cyan-500" />
                <span className="font-bold">GitX Assistant</span>
              </div>
              <p className="font-medium">
                I&#39;ve processed the repository at {projectName}. What would
                you like to know about this codebase?
              </p>
            </div>
          </div>

          {/* Display Messages */}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`mb-4 ${message.role === "user" ? "ml-12" : "mr-12"}`}
            >
              <div
                className={`p-4 rounded-lg border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
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

                {/* Message Content */}
                <div className="markdown-content font-medium">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={nord}
                            language={match[1]}
                            PreTag="div"
                            className="border-2 border-black rounded my-2"
                            {...props}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        ) : (
                          <code
                            className="bg-gray-200 px-1 py-0.5 rounded"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {message.content.trim()}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Field */}
        <form
          onSubmit={handleSubmitWrapper}
          className="flex flex-col md:flex-row gap-4"
        >
          <Input
            type="text"
            placeholder="Ask something about the codebase..."
            className="flex-1 p-4 border-4 border-black h-14 text-sm md:text-lg font-medium rounded-lg focus-visible:ring-cyan-500"
            value={input}
            onChange={handleInputChange}
          />
          <Button
            type="submit"
            className="h-14 flex items-center justify-center p-4 text-lg font-bold bg-cyan-500 hover:bg-cyan-600 text-white border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
          >
            <Send className="h-5 w-5 mr-2" />
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

export default ChatInterface;
