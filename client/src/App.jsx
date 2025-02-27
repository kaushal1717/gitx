import { Outlet } from "react-router-dom";

function App() {
  return (
    <>
      <div className="m-3">
        <Outlet />
      </div>
    </>
  );
}

export default App;
