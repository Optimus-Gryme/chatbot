// frontend/huibook-frontend/src/components/public/PublicBookingPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { functions, auth } from '../../firebaseConfig'; // Path to your firebaseConfig, added auth
import { httpsCallable } from 'firebase/functions';

const getEventsCallable = httpsCallable(functions, 'getEvents');
const createBookingCallable = httpsCallable(functions, 'createBooking');
const getFormSchemaCallable = httpsCallable(functions, 'getFormSchema'); // For fetching form schema

function PublicBookingPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedEventForBooking, setSelectedEventForBooking] = useState(null);

  // Booking form state (standard fields)
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [numberOfAttendees, setNumberOfAttendees] = useState(1);
  // const [bookingNotes, setBookingNotes] = useState(''); // Keeping this if still desired

  // Dynamic form state
  const [currentFormSchema, setCurrentFormSchema] = useState(null);
  const [formData, setFormData] = useState({}); // For dynamic field values
  const [isFetchingFormSchema, setIsFetchingFormSchema] = useState(false);
  
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
        // Ensure formId is passed along if it exists on the event
        formId: event.formId || null, 
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
  
  const openBookingModal = async (event) => {
    setSelectedEventForBooking(event);
    setBookingMessage({ type: '', text: '' });
    
    // Reset dynamic form related state
    setCurrentFormSchema(null);
    setFormData({});
    
    // Pre-fill standard fields
    const currentUser = auth.currentUser;
    setGuestName(currentUser?.displayName || '');
    setGuestEmail(currentUser?.email || '');
    setNumberOfAttendees(1);
    // setBookingNotes(''); // Reset if you are using this field

    if (event.formId) {
      setIsFetchingFormSchema(true);
      try {
        const result = await getFormSchemaCallable({ formId: event.formId });
        if (result.data && result.data.fields) {
          setCurrentFormSchema(result.data);
          // Initialize formData based on schema fields
          const initialFormData = {};
          result.data.fields.forEach(field => {
            initialFormData[field.fieldId] = field.defaultValue || (field.type === 'checkbox' ? false : '');
          });
          setFormData(initialFormData);
        } else {
          console.warn("Form schema fetched but is invalid or has no fields:", result.data);
          setBookingMessage({ type: 'warning', text: "Custom form for this event is not configured correctly. Using basic form." });
        }
      } catch (err) {
        console.error("Error fetching form schema:", err);
        setBookingMessage({ type: 'error', text: `Could not load custom form: ${err.message}. Using basic form.` });
      } finally {
        setIsFetchingFormSchema(false);
      }
    }
    setIsBookingModalOpen(true);
  };

  const closeBookingModal = () => {
    setIsBookingModalOpen(false);
    setSelectedEventForBooking(null);
    setCurrentFormSchema(null);
    setFormData({});
    setBookingMessage({ type: '', text: '' });
  };

  const handleDynamicFieldChange = (fieldId, value, type = 'text') => {
    setFormData(prevData => ({
      ...prevData,
      [fieldId]: type === 'checkbox' ? !prevData[fieldId] : value,
    }));
  };
  
  const handleStandardFieldChange = (setter) => (e) => {
    setter(e.target.value);
  };


  const handleBookingSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEventForBooking) return;

    setBookingMessage({ type: 'info', text: 'Submitting booking...' });

    const bookingPayload = {
      eventId: selectedEventForBooking.id,
      guestName,
      guestEmail,
      numberOfAttendees: parseInt(numberOfAttendees, 10) || 1,
      // bookingNotes, // Include if you are still using this field
      formSubmissionData: currentFormSchema ? formData : null,
    };

    try {
      const result = await createBookingCallable(bookingPayload);
      setBookingMessage({ type: 'success', text: `Booking successful! Your booking ID: ${result.data.id}. A confirmation may be sent to your email.` });
      // setTimeout(closeBookingModal, 5000); // Optional: close modal after delay
    } catch (err) {
      console.error("Error creating booking:", err);
      setBookingMessage({ type: 'error', text: `Booking failed: ${err.message}. Please try again.` });
    }
  };
  
  if (loading && !events.length) { // Show loading only on initial load
    return <p>Loading events...</p>;
  }

  if (error) {
    return <p style={{ color: 'red' }}>Error fetching events: {error}</p>;
  }

  return (
    <div>
      <h2>Available Events</h2>
      {events.length === 0 && !loading ? ( // Show no events only if not loading
        <p>No events available at the moment.</p>
      ) : (
        <ul>
          {events.map(event => (
            <li key={event.id} style={{ marginBottom: '20px', border: '1px solid #eee', padding: '10px' }}>
              <h3>{event.title}</h3>
              <p><strong>Starts:</strong> {event.start.toLocaleString()}</p>
              <p><strong>Ends:</strong> {event.end.toLocaleString()}</p>
              {event.description && <p><strong>Description:</strong> {event.description}</p>}
              {event.formId && <p><small><em>Custom booking form available.</em></small></p>}
              <button onClick={() => openBookingModal(event)}> 
                Book Now
              </button>
            </li>
          ))}
        </ul>
      )}

      {isBookingModalOpen && selectedEventForBooking && (
        <div className="modal" style={{ position: 'fixed', top: '5%', left: '15%', right: '15%', background: 'white', border: '1px solid #ccc', padding: '20px', zIndex: 1000, overflowY: 'auto', maxHeight: '90vh', boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }}>
          <h3>Book Event: {selectedEventForBooking.title}</h3>
          <form onSubmit={handleBookingSubmit}>
            {/* Standard Fields */}
            <div style={{ marginBottom: '10px' }}>
              <label htmlFor="guestName" style={{ display: 'block', marginBottom: '5px' }}>Your Name:</label>
              <input id="guestName" type="text" value={guestName} onChange={handleStandardFieldChange(setGuestName)} required style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}/>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label htmlFor="guestEmail" style={{ display: 'block', marginBottom: '5px' }}>Your Email:</label>
              <input id="guestEmail" type="email" value={guestEmail} onChange={handleStandardFieldChange(setGuestEmail)} required style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}/>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label htmlFor="numberOfAttendees" style={{ display: 'block', marginBottom: '5px' }}>Number of Attendees:</label>
              <input id="numberOfAttendees" type="number" value={numberOfAttendees} onChange={handleStandardFieldChange(setNumberOfAttendees)} min="1" required style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}/>
            </div>

            {/* Dynamic Form Section */}
            {isFetchingFormSchema && <p>Loading custom form fields...</p>}
            {!isFetchingFormSchema && currentFormSchema && currentFormSchema.fields && (
              <fieldset style={{marginTop: '20px', border: '1px dashed #ccc', padding: '15px'}}>
                <legend>{currentFormSchema.formName || 'Additional Information'}</legend>
                {currentFormSchema.description && <p><small>{currentFormSchema.description}</small></p>}
                {currentFormSchema.fields.map(field => (
                  <div key={field.fieldId} style={{ marginBottom: '15px' }}>
                    <label htmlFor={field.fieldId} style={{ display: 'block', marginBottom: '5px' }}>
                      {field.label}{field.required && <span style={{color: 'red'}}>*</span>}:
                    </label>
                    { (field.type === 'text' || field.type === 'email' || field.type === 'number' || field.type === 'date') &&
                      <input 
                        type={field.type} id={field.fieldId} name={field.fieldId}
                        value={formData[field.fieldId] || ''}
                        onChange={(e) => handleDynamicFieldChange(field.fieldId, e.target.value)}
                        placeholder={field.placeholder} required={field.required} 
                        style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                      />
                    }
                    { field.type === 'textarea' && 
                      <textarea
                        id={field.fieldId} name={field.fieldId}
                        value={formData[field.fieldId] || ''}
                        onChange={(e) => handleDynamicFieldChange(field.fieldId, e.target.value)}
                        placeholder={field.placeholder} required={field.required}
                        style={{ width: 'calc(100% - 16px)', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px' }}
                      />
                    }
                    { field.type === 'dropdown' && 
                      <select 
                        id={field.fieldId} name={field.fieldId}
                        value={formData[field.fieldId] || ''}
                        onChange={(e) => handleDynamicFieldChange(field.fieldId, e.target.value)}
                        required={field.required}
                        style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                      >
                        <option value="">{field.placeholder || 'Select...'}</option>
                        {Array.isArray(field.options) && field.options.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    }
                    { field.type === 'checkbox' && 
                      <div style={{display: 'flex', alignItems: 'center'}}>
                        <input 
                          type="checkbox" id={field.fieldId} name={field.fieldId}
                          checked={formData[field.fieldId] || false}
                          onChange={() => handleDynamicFieldChange(field.fieldId, '', 'checkbox')} // Value is ignored, type is key
                          required={field.required}
                          style={{ marginRight: '5px', height: '16px', width: '16px' }}
                        />
                         {/* Checkbox label is already above, this is more for inline text if needed */}
                         {/* <label htmlFor={field.fieldId} style={{fontWeight: 'normal'}}>{field.placeholder || ''}</label> */}
                      </div>
                    }
                  </div>
                ))}
              </fieldset>
            )}
            
            {bookingMessage.text && (
              <p style={{ color: bookingMessage.type === 'error' ? 'red' : (bookingMessage.type === 'success' ? 'green' : 'blue'), marginTop: '15px', marginBottom: '15px', padding: '10px', border: `1px solid ${bookingMessage.type === 'error' ? 'red' : (bookingMessage.type === 'success' ? 'green' : 'blue')}`, borderRadius: '4px', background: bookingMessage.type === 'error' ? '#ffebee' : (bookingMessage.type === 'success' ? '#e8f5e9' : '#e3f2fd') }}>
                {bookingMessage.text}
              </p>
            )}

            <div style={{marginTop: '20px'}}>
              <button type="submit" style={{ padding: '10px 15px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }} disabled={isFetchingFormSchema}>
                {isFetchingFormSchema ? 'Loading Form...' : 'Submit Booking'}
              </button>
              <button type="button" onClick={closeBookingModal} style={{ marginLeft: '10px', padding: '10px 15px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default PublicBookingPage;
