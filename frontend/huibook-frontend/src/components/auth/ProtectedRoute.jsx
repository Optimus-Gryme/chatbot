// frontend/huibook-frontend/src/components/auth/ProtectedRoute.jsx
import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { auth } from '../../firebaseConfig'; // Path to your firebaseConfig

const ProtectedRoute = () => {
  // If auth.currentUser is not available immediately,
  // this might need to rely on the loading state from App.jsx
  // or a shared auth context for a more robust solution.
  // For this step, a direct check is okay, assuming App.jsx has updated the auth state.
  if (!auth.currentUser) {
    // User not authenticated
    return <Navigate to="/login" replace />;
  }

  // User is authenticated, render the child route content
  return <Outlet />;
};

export default ProtectedRoute;
