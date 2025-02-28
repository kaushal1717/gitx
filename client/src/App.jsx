import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";

function App() {
  return (
    <>
      <div className="m-3">
        <Outlet />
        <Toaster richColors closeButton />
      </div>
    </>
  );
}

export default App;
