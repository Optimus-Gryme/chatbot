// frontend/huibook-frontend/src/components/public/PublicBookingPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { functions, auth } from '../../firebaseConfig'; // Path to your firebaseConfig, added auth
import { httpsCallable } from 'firebase/functions';

const getEventsCallable = httpsCallable(functions, 'getEvents');
const createBookingCallable = httpsCallable(functions, 'createBooking');

function PublicBookingPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedEventForBooking, setSelectedEventForBooking] = useState(null);

  // Booking form state
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [numberOfAttendees, setNumberOfAttendees] = useState(1);
  const [bookingNotes, setBookingNotes] = useState('');
  const [bookingMessage, setBookingMessage] = useState({ type: '', text: '' });

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEventsCallable();
      const formattedEvents = result.data.map(event => ({
        ...event,
        start: event.start.toDate ? event.start.toDate() : new Date(event.start),
        end: event.end.toDate ? event.end.toDate() : new Date(event.end),
      }));
      setEvents(formattedEvents);
    } catch (err) {
      console.error("Error fetching events:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Pre-fill name and email if user is logged in
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (currentUser && isBookingModalOpen) { // Check isBookingModalOpen to only run when modal is open
      setGuestName(currentUser.displayName || guestName || ''); // Keep existing if displayName is null
      setGuestEmail(currentUser.email || guestEmail || '');       // Keep existing if email is null
    } else if (!currentUser && isBookingModalOpen) {
      // If modal is open and user logs out or was never logged in, clear fields
      // (This depends on how auth state is managed globally vs. locally here)
      // For now, this effect primarily targets pre-filling when modal opens.
    }
  }, [isBookingModalOpen, guestName, guestEmail]); // Rerun if modal opens or if auth state potentially changes leading to name/email changes


  const openBookingModal = (event) => {
    setSelectedEventForBooking(event);
    setBookingMessage({ type: '', text: '' }); // Clear previous messages
    
    const currentUser = auth.currentUser;
    if (currentUser) {
        setGuestName(currentUser.displayName || ''); // Reset to current user's details or empty
        setGuestEmail(currentUser.email || '');
    } else {
        // Clear if no user, or reset to default
        setGuestName('');
        setGuestEmail('');
    }
    setNumberOfAttendees(1);
    setBookingNotes('');
    setIsBookingModalOpen(true);
  };

  const closeBookingModal = () => {
    setIsBookingModalOpen(false);
    setSelectedEventForBooking(null);
    // Do not clear bookingMessage here if you want it to persist until next open
  };

  const handleBookingSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEventForBooking) return;

    setBookingMessage({ type: 'info', text: 'Submitting booking...' });

    const bookingData = {
      eventId: selectedEventForBooking.id,
      guestName,
      guestEmail,
      numberOfAttendees: parseInt(numberOfAttendees, 10) || 1,
      bookingNotes,
    };

    try {
      const result = await createBookingCallable(bookingData);
      setBookingMessage({ type: 'success', text: `Booking successful! Your booking ID: ${result.data.id}. A confirmation may be sent to your email.` });
      // Optionally close modal after a delay or keep it open to show success
      // setTimeout(closeBookingModal, 5000); 
    } catch (err) {
      console.error("Error creating booking:", err);
      setBookingMessage({ type: 'error', text: `Booking failed: ${err.message}. Please try again.` });
    }
  };
  
  if (loading) {
    return <p>Loading events...</p>;
  }

  if (error) {
    return <p style={{ color: 'red' }}>Error fetching events: {error}</p>;
  }

  return (
    <div>
      <h2>Available Events</h2>
      {events.length === 0 ? (
        <p>No events available at the moment.</p>
      ) : (
        <ul>
          {events.map(event => (
            <li key={event.id} style={{ marginBottom: '20px', border: '1px solid #eee', padding: '10px' }}>
              <h3>{event.title}</h3>
              <p><strong>Starts:</strong> {event.start.toLocaleString()}</p>
              <p><strong>Ends:</strong> {event.end.toLocaleString()}</p>
              {event.description && <p><strong>Description:</strong> {event.description}</p>}
              <button onClick={() => openBookingModal(event)}> 
                Book Now
              </button>
            </li>
          ))}
        </ul>
      )}

      {isBookingModalOpen && selectedEventForBooking && (
        <div className="modal" style={{ position: 'fixed', top: '10%', left: '20%', right: '20%', background: 'white', border: '1px solid #ccc', padding: '20px', zIndex: 1000, overflowY: 'auto', maxHeight: '80vh', boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }}>
          <h3>Book Event: {selectedEventForBooking.title}</h3>
          <form onSubmit={handleBookingSubmit}>
            <div style={{ marginBottom: '10px' }}>
              <label htmlFor="guestName" style={{ display: 'block', marginBottom: '5px' }}>Your Name:</label>
              <input id="guestName" type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} required style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}/>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label htmlFor="guestEmail" style={{ display: 'block', marginBottom: '5px' }}>Your Email:</label>
              <input id="guestEmail" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} required style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}/>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label htmlFor="numberOfAttendees" style={{ display: 'block', marginBottom: '5px' }}>Number of Attendees:</label>
              <input id="numberOfAttendees" type="number" value={numberOfAttendees} onChange={(e) => setNumberOfAttendees(e.target.value)} min="1" required style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}/>
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label htmlFor="bookingNotes" style={{ display: 'block', marginBottom: '5px' }}>Notes (optional):</label>
              <textarea id="bookingNotes" value={bookingNotes} onChange={(e) => setBookingNotes(e.target.value)} style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px' }}></textarea>
            </div>
            
            {bookingMessage.text && (
              <p style={{ color: bookingMessage.type === 'error' ? 'red' : (bookingMessage.type === 'success' ? 'green' : 'blue'), marginTop: '0', marginBottom: '15px', padding: '10px', border: `1px solid ${bookingMessage.type === 'error' ? 'red' : (bookingMessage.type === 'success' ? 'green' : 'blue')}`, borderRadius: '4px', background: bookingMessage.type === 'error' ? '#ffebee' : (bookingMessage.type === 'success' ? '#e8f5e9' : '#e3f2fd') }}>
                {bookingMessage.text}
              </p>
            )}

            <button type="submit" style={{ padding: '10px 15px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Submit Booking</button>
            <button type="button" onClick={closeBookingModal} style={{ marginLeft: '10px', padding: '10px 15px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default PublicBookingPage;
