// frontend/huibook-frontend/src/components/admin/AdminDashboard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom'; // Import Link
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from "@fullcalendar/interaction"; // for dateClick and eventClick
import { auth, functions } from '../../firebaseConfig'; // Path to your firebaseConfig, ensure auth is imported
import { httpsCallable } from 'firebase/functions';

// Import FullCalendar CSS (ensure paths are correct)
import '@fullcalendar/common/main.css';
import '@fullcalendar/daygrid/main.css';

// Define callable functions (consider defining these outside component or memoizing)
const getEventsCallable = httpsCallable(functions, 'getEvents');
const createEventCallable = httpsCallable(functions, 'createEvent');
const updateEventCallable = httpsCallable(functions, 'updateEvent');
const deleteEventCallable = httpsCallable(functions, 'deleteEvent');
const listFormSchemasCallable = httpsCallable(functions, 'listFormSchemas'); // Added for fetching forms
const getGoogleCalendarAuthUrlCallable = httpsCallable(functions, 'getGoogleCalendarAuthUrl'); // For Google Calendar Auth

function AdminDashboard() {
  const [events, setEvents] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' or 'edit'
  const [availableForms, setAvailableForms] = useState([]);
  const [formFetchError, setFormFetchError] = useState(null);
  
  // Google Calendar connection state
  const [isConnectingToGoogle, setIsConnectingToGoogle] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState(null);
  
  // Form state for the modal
  const [currentEventId, setCurrentEventId] = useState(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(''); // Use string for input type='datetime-local'
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFormId, setSelectedFormId] = useState(''); // For the dropdown in the modal
  // Add other event fields as needed e.g. allDay

  const fetchEvents = useCallback(async () => {
    try {
      const result = await getEventsCallable();
      // Ensure start/end are in a format FullCalendar understands (Date objects or ISO strings)
      // Firestore Timestamps need to be converted if they are part of the result.data
      const formattedEvents = result.data.map(event => ({
        ...event,
        // If start/end are Firestore Timestamps, convert them:
         start: event.start && event.start.toDate ? event.start.toDate() : event.start,
         end: event.end && event.end.toDate ? event.end.toDate() : event.end,
        // title, id are usually fine
      }));
      setEvents(formattedEvents);
    } catch (error) {
      console.error("Error fetching events:", error);
      alert("Error fetching events: " + error.message);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    
    // Fetch available forms
    const fetchFormsForAdmin = async () => {
      setFormFetchError(null);
      try {
        const result = await listFormSchemasCallable();
        setAvailableForms(result.data || []);
      } catch (error) {
        console.error("Error fetching available forms:", error);
        setFormFetchError("Failed to load forms: " + error.message);
      }
    };
    fetchFormsForAdmin();

  }, [fetchEvents]); // fetchEvents is already memoized with useCallback

  const openModal = (mode, data = {}) => {
    setIsModalOpen(true);
    setModalMode(mode);
    // Reset common fields
    setTitle(data.title || '');
    setDescription(data.description || '');
    setSelectedFormId(data.formId || ''); // Set selected form if event has one

    if (mode === 'create') {
      setCurrentEventId(null);
      // data.dateStr might be passed from handleDateClick for pre-filling date
      const initialStartDate = data.dateStr ? data.dateStr + "T09:00" : new Date().toISOString().slice(0,16);
      const initialEndDate = data.dateStr ? data.dateStr + "T10:00" : new Date(new Date(initialStartDate).getTime() + 60 * 60 * 1000).toISOString().slice(0,16); // 1 hour later
      setStartDate(initialStartDate);
      setEndDate(initialEndDate);
    } else if (mode === 'edit') {
      setCurrentEventId(data.id);
      // Ensure date format is compatible with datetime-local input
      const formatDateTimeLocal = (dateObj) => {
        if (!dateObj) return '';
        const d = new Date(dateObj);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); // Adjust for local timezone
        return d.toISOString().slice(0, 16);
      };
      setStartDate(formatDateTimeLocal(data.start));
      setEndDate(formatDateTimeLocal(data.end));
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    // Reset form fields to default if desired, or simply close
    setTitle('');
    setStartDate('');
    setEndDate('');
    setDescription('');
    setSelectedFormId('');
    setCurrentEventId(null);
  };

  const handleDateClick = (arg) => {
    openModal('create', { dateStr: arg.dateStr });
  };

  const handleEventClick = (clickInfo) => {
    openModal('edit', { 
      id: clickInfo.event.id, 
      title: clickInfo.event.title,
      start: clickInfo.event.start,
      end: clickInfo.event.end,
      description: clickInfo.event.extendedProps.description,
      formId: clickInfo.event.extendedProps.formId // Pass formId from FullCalendar event
      // allDay: clickInfo.event.allDay (if used)
    });
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    const eventPayload = {
      title,
      start: new Date(startDate).toISOString(),
      end: new Date(endDate).toISOString(),
      description,
      formId: selectedFormId || null, // Add selectedFormId to the payload
      // allDay: (if implemented)
    };

    try {
      if (modalMode === 'create') {
        await createEventCallable(eventData);
        alert('Event created successfully!');
      } else if (modalMode === 'edit' && currentEventId) {
        await updateEventCallable({ eventId: currentEventId, ...eventData });
        alert('Event updated successfully!');
      }
      fetchEvents(); // Refresh calendar
      closeModal();
    } catch (error) {
      console.error(`Error ${modalMode}ing event:`, error);
      alert(`Error ${modalMode}ing event: ` + error.message);
    }
  };

  const handleDelete = async () => {
    if (!currentEventId) return;
    if (window.confirm("Are you sure you want to delete this event?")) {
      try {
        await deleteEventCallable({ eventId: currentEventId });
        alert('Event deleted successfully!');
        fetchEvents(); // Refresh calendar
        closeModal();
      } catch (error) {
        console.error("Error deleting event:", error);
        alert("Error deleting event: " + error.message);
      }
    }
  };

  return (
    <div>
      <h2>Admin Dashboard</h2>
      <Link to="/admin/forms">Manage Event Forms</Link>
      <hr style={{ margin: '20px 0' }}/>

      <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #eee' }}>
        <h4>Google Calendar Integration</h4>
        <button onClick={handleConnectGoogleCalendar} disabled={isConnectingToGoogle}>
          {isConnectingToGoogle ? "Connecting..." : "Connect to Google Calendar"}
        </button>
        {googleAuthError && <p style={{ color: 'red' }}>{googleAuthError}</p>}
        <p style={{fontSize: '0.8em', color: 'gray'}}>
            You will be redirected to Google to authorize access to your calendar.
        </p>
      </div>
      
      <button onClick={() => openModal('create')}>Add New Event</button>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        weekends={true}
        events={events}
        dateClick={handleDateClick}
        eventClick={handleEventClick} // Handle event click
        editable={true} // Optional: allow drag-and-drop editing (requires more handlers)
        selectable={true} // Optional: allow date range selection
      />

      {isModalOpen && (
        <div className="modal" style={{ position: 'fixed', top: '10%', left: '25%', width: '50%', background: 'white', border: '1px solid #ccc', padding: '20px', zIndex: 1000, maxHeight: '80vh', overflowY: 'auto' }}>
          <h3>{modalMode === 'create' ? 'Create Event' : 'Edit Event'}</h3>
          <form onSubmit={handleSubmit}>
            <div>
              <label htmlFor="eventTitle">Title:</label>
              <input id="eventTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="eventStart">Start Date:</label>
              <input id="eventStart" type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="eventEnd">End Date:</label>
              <input id="eventEnd" type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="eventDescription">Description:</label>
              <textarea id="eventDescription" value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
            </div>
            <div>
              <label htmlFor="eventForm">Associated Form (Optional):</label>
              <select id="eventForm" value={selectedFormId} onChange={(e) => setSelectedFormId(e.target.value)}>
                <option value="">-- None --</option>
                {availableForms.map(form => (
                  <option key={form.id} value={form.id}>
                    {form.formName} (Fields: {form.fieldCount !== undefined ? form.fieldCount : 'N/A'})
                  </option>
                ))}
              </select>
              {formFetchError && <p style={{color: 'red', fontSize: '0.8em'}}>{formFetchError}</p>}
            </div>
            <button type="submit">{modalMode === 'create' ? 'Create' : 'Save Changes'}</button>
            <button type="button" onClick={closeModal}>Cancel</button>
            {modalMode === 'edit' && (
              <button type="button" onClick={handleDelete} style={{ marginLeft: '10px', background: 'red', color: 'white' }}>
                Delete Event
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
export default AdminDashboard;
