// frontend/huibook-frontend/src/components/admin/AdminDashboard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom'; // Import Link
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from "@fullcalendar/interaction"; // for dateClick and eventClick
import { functions } from '../../firebaseConfig'; // Path to your firebaseConfig
import { httpsCallable } from 'firebase/functions';

// Import FullCalendar CSS (ensure paths are correct)
import '@fullcalendar/common/main.css';
import '@fullcalendar/daygrid/main.css';

// Define callable functions (consider defining these outside component or memoizing)
const getEventsCallable = httpsCallable(functions, 'getEvents');
const createEventCallable = httpsCallable(functions, 'createEvent');
const updateEventCallable = httpsCallable(functions, 'updateEvent');
const deleteEventCallable = httpsCallable(functions, 'deleteEvent');

function AdminDashboard() {
  const [events, setEvents] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' or 'edit'
  
  // Form state for the modal
  const [currentEventId, setCurrentEventId] = useState(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(''); // Use string for input type='datetime-local'
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
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
  }, [fetchEvents]);

  const openModal = (mode, data = {}) => {
    setIsModalOpen(true);
    setModalMode(mode);
    if (mode === 'create') {
      setCurrentEventId(null);
      setTitle('');
      // data.dateStr might be passed from handleDateClick
      setStartDate(data.dateStr ? data.dateStr + "T09:00" : ''); // Default time or use selected
      setEndDate(data.dateStr ? data.dateStr + "T10:00" : '');
      setDescription('');
    } else if (mode === 'edit') {
      setCurrentEventId(data.id);
      setTitle(data.title || '');
      // Ensure date format is compatible with datetime-local input
      // FullCalendar event.start/end are Date objects
      const formatDateTimeLocal = (dateObj) => {
        if (!dateObj) return '';
        const d = new Date(dateObj);
        // Adjust for timezone offset to display correctly in local time input
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
      };
      setStartDate(formatDateTimeLocal(data.start));
      setEndDate(formatDateTimeLocal(data.end));
      setDescription(data.description || '');
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    // Reset form fields if desired
  };

  const handleDateClick = (arg) => {
    openModal('create', { dateStr: arg.dateStr });
  };

  const handleEventClick = (clickInfo) => {
    // clickInfo.event contains the event object from FullCalendar
    openModal('edit', { 
      id: clickInfo.event.id, 
      title: clickInfo.event.title,
      start: clickInfo.event.start,
      end: clickInfo.event.end,
      description: clickInfo.event.extendedProps.description // Custom props are in extendedProps
      // allDay: clickInfo.event.allDay
    });
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    const eventData = {
      title,
      start: new Date(startDate).toISOString(), // Convert to ISO string or Firebase Timestamp for backend
      end: new Date(endDate).toISOString(),
      description,
      // allDay, formId (if implemented)
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
