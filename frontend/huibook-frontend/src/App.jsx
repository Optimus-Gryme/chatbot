// frontend/huibook-frontend/src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { auth } from './firebaseConfig';
import { onAuthStateChanged, signOut } from 'firebase/auth';

import Login from './components/auth/Login';
import Registration from './components/auth/Registration';
import AdminDashboard from './components/admin/AdminDashboard';
import FormBuilderPage from './components/admin/FormBuilderPage'; // Import FormBuilderPage
import ProtectedRoute from './components/auth/ProtectedRoute'; // Import ProtectedRoute
import PublicBookingPage from './components/public/PublicBookingPage'; // Import PublicBookingPage
import './App.css';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // No need to redirect here, Routes will handle it
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (loading) {
    return <p>Loading application...</p>;
  }

  return (
    <Router>
      <div>
        <nav>
          <ul>
            <li><Link to="/">Home (Public)</Link></li>
            <li><Link to="/book">Book an Event</Link></li> {/* Link to booking page */}
            {currentUser ? (
              <>
                <li><Link to="/admin">Admin Dashboard</Link></li>
                <li><button onClick={handleLogout}>Logout</button></li>
              </>
            ) : (
              <>
                <li><Link to="/login">Login</Link></li>
                <li><Link to="/register">Register</Link></li>
              </>
            )}
          </ul>
        </nav>
        <hr />
        <Routes>
          <Route path="/login" element={currentUser ? <Navigate to="/admin" /> : <Login />} />
          <Route path="/register" element={currentUser ? <Navigate to="/admin" /> : <Registration />} />
          <Route path="/book" element={<PublicBookingPage />} /> {/* Route for booking page */}

          {/* Protected Admin Route */}
          <Route path="/admin" element={<ProtectedRoute />}>
            <Route index element={<AdminDashboard />} />
            <Route path="forms" element={<FormBuilderPage />} /> {/* Route for FormBuilderPage */}
            {/* Add more admin sub-routes here if needed */}
          </Route>

          <Route path="/" element={
            <div>
              <h2>Public Home Page</h2>
              <p>Welcome to HuiBook! Browse events and book your Marae visit.</p>
              {currentUser && <p>Logged in as: {currentUser.email}</p>}
            </div>
          } />
          {/* Fallback for non-matched routes or redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
