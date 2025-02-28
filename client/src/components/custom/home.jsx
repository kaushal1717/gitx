import { useState } from "react";
import { Github, Loader } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function Home() {
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleProcess = async (e) => {
    e.preventDefault();
    setError("");
    if (!repoUrl.trim()) return;

    setLoading(true);
    const projectName = repoUrl.split("/")[4];

    try {
      const response = await fetch("http://localhost:5001/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Processing failed");
      }

      navigate(`/chat?repo=${encodeURIComponent(projectName)}`);
    } catch (err) {
      setError(err.message || "Something went wrong");
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-yellow-50">
      <header className="border-b-4 border-black bg-white">
        <div className="container flex h-20 items-center justify-between">
          <span className="text-3xl font-black text-black">
            Git<span className="text-cyan-500">X</span>
          </span>
          <a
            href="#"
            className="flex items-center gap-2 text-sm font-bold text-black hover:text-cyan-500 transition-colors"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className="container py-12 md:py-24 text-center">
          <div className="mx-auto max-w-3xl space-y-8">
            <h1 className="text-4xl font-black tracking-tight text-black md:text-6xl">
              Chat with your <span className="text-cyan-500">codebase</span>
            </h1>
            <p className="max-w-2xl mx-auto text-lg md:text-xl font-bold text-black">
              Turn any Git repository into an interactive AI assistant that
              understands your code.
            </p>
            <p className="text-black font-medium">
              Simply provide a repository URL and start asking questions about
              your codebase.
            </p>
          </div>

          {/* ✅ Restored Missing Section */}
          <div className="mx-auto mt-12 max-w-2xl rounded-xl border-4 border-black bg-white p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <form onSubmit={handleProcess} className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4">
                <Input
                  type="text"
                  placeholder="https://github.com/..."
                  className="flex-1 p-4 border-4 border-black h-14 text-lg font-medium rounded-lg focus-visible:ring-cyan-500"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={loading}
                  required
                />
                <Button
                  type="submit"
                  className="h-14 px-8 text-lg font-bold bg-cyan-500 hover:bg-cyan-600 text-white border-4 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader className="h-5 w-5 animate-spin" />
                  ) : (
                    "Process"
                  )}
                </Button>
              </div>
              {error && <p className="text-red-600 font-bold">{error}</p>}
            </form>
          </div>

          {/* ✅ Restored Missing Yellow Box */}
          <div className="mx-auto mt-12 max-w-2xl text-center">
            <div className="inline-block rounded-xl border-4 border-black bg-yellow-400 p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-xl font-bold text-black">
                After processing, you can chat with your repository using our
                advanced RAG system.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-4 border-black bg-white py-6 text-center">
        <p className="text-lg font-bold text-black"></p>
      </footer>
    </div>
  );
}

export default Home;
