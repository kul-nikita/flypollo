import { Link } from "react-router-dom";

export default function Home() {
  return (
    <section className="home">
      <div className="hero">
        <h1>Live quizzes for hospital training</h1>
        <p>
          Run interactive quiz sessions during staff education and training.
          Presenters create questions in <strong>Admin</strong>, participants
          answer in <strong>Join</strong>.
        </p>
      </div>
      <div className="card-grid">
        <Link to="/admin" className="card">
          <h2>Admin</h2>
          <p>Create and launch a live quiz session for the room.</p>
        </Link>
        <Link to="/join" className="card">
          <h2>Join</h2>
          <p>Join a running session with a room code and answer live.</p>
        </Link>
      </div>
    </section>
  );
}
