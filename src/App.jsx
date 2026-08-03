import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import Join from "./pages/Join";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Flypollo
        </Link>
        <span className="tagline">hospital training quizzes</span>
        <nav className="app-nav">
          <Link to="/admin">Admin</Link>
          <Link to="/join">Join</Link>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/join" element={<Join />} />
        </Routes>
      </main>
    </div>
  );
}
