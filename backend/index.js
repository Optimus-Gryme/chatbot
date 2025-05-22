const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

// Helper to check authentication
const ensureAuthenticated = (context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }
};

// Create Event
exports.createEvent = functions.https.onCall(async (data, context) => {
  ensureAuthenticated(context);
  const { title, start, end, description, allDay, formId } = data;
  const userId = context.auth.uid;

  if (!title || !start || !end) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required fields: title, start, end.'
    );
  }

  try {
    const newEventRef = await db.collection('events').add({
      title,
      start, // Store as ISO8601 string or Firestore Timestamp
      end,   // Store as ISO8601 string or Firestore Timestamp
      description: description || null,
      allDay: allDay || false,
      formId: formId || null,
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const newEvent = await newEventRef.get();
    return { id: newEvent.id, ...newEvent.data() };
  } catch (error) {
    console.error("Error creating event:", error);
    throw new functions.https.HttpsError('internal', 'Could not create event.', error.message);
  }
});

// Get Events
exports.getEvents = functions.https.onCall(async (data, context) => {
  // No auth check needed for public read, or add one if events should be private
  // For admin dashboard, auth check might be desired.
  // ensureAuthenticated(context); 
  try {
    const eventsSnapshot = await db.collection('events').orderBy('start', 'asc').get();
    const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return events;
  } catch (error) {
    console.error("Error getting events:", error);
    throw new functions.https.HttpsError('internal', 'Could not fetch events.', error.message);
  }
});

// Update Event
exports.updateEvent = functions.https.onCall(async (data, context) => {
  ensureAuthenticated(context);
  const { eventId, ...eventData } = data;
  const userId = context.auth.uid; // For ownership check

  if (!eventId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing eventId.');
  }
  if (Object.keys(eventData).length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'No data provided for update.');
  }

  const eventRef = db.collection('events').doc(eventId);

  try {
    const doc = await eventRef.get();
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'Event not found.');
    }
    // Optional: Check ownership 
    // if (doc.data().userId !== userId) { 
    //   throw new functions.https.HttpsError('permission-denied', 'You do not have permission to update this event.');
    // }

    await eventRef.update({
      ...eventData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const updatedDoc = await eventRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  } catch (error) {
    console.error("Error updating event:", error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Could not update event.', error.message);
  }
});

// Delete Event
exports.deleteEvent = functions.https.onCall(async (data, context) => {
  ensureAuthenticated(context);
  const { eventId } = data;
  const userId = context.auth.uid; // For ownership check

  if (!eventId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing eventId.');
  }

  const eventRef = db.collection('events').doc(eventId);

  try {
    const doc = await eventRef.get();
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'Event not found.');
    }
    // Optional: Check ownership
    // if (doc.data().userId !== userId) { 
    //   throw new functions.https.HttpsError('permission-denied', 'You do not have permission to delete this event.');
    // }

    await eventRef.delete();
    return { message: `Event ${eventId} deleted successfully.` };
  } catch (error) {
    console.error("Error deleting event:", error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Could not delete event.', error.message);
  }
});

// Create Booking
exports.createBooking = functions.https.onCall(async (data, context) => {
  const { eventId, guestName, guestEmail, numberOfAttendees, bookingNotes } = data;
  let userId = null;
  if (context.auth) {
    userId = context.auth.uid;
  }

  if (!eventId || !guestName || !guestEmail) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required fields: eventId, guestName, guestEmail.'
    );
  }

  try {
    const eventRef = db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'The selected event does not exist.');
    }
    const eventTitle = eventDoc.data().title;

    const newBookingRef = await db.collection('bookings').add({
      eventId,
      eventTitle, // Denormalized for convenience
      userId, // Null if not logged in
      guestName,
      guestEmail,
      numberOfAttendees: numberOfAttendees || 1,
      bookingNotes: bookingNotes || null,
      status: 'pending', // Default status
      bookedAt: admin.firestore.FieldValue.serverTimestamp(),
      // formSubmissionData will be added later if dynamic forms are used
    });
    const newBooking = await newBookingRef.get();
    return { id: newBooking.id, ...newBooking.data() };
  } catch (error) {
    console.error("Error creating booking:", error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Could not create booking.', error.message);
  }
});

// --- Form Schema Functions ---

// Helper to simulate admin check (replace with actual admin check later)
const ensureAdmin = (context) => {
  ensureAuthenticated(context);
  // TODO: Implement actual admin role verification
  // For now, any authenticated user is treated as admin for this.
  // In a real app, check for custom claims: context.auth.token.isAdmin === true
  // or look up user role in a separate 'users' collection.
  // if (!context.auth.token.isAdmin) {
  //   throw new functions.https.HttpsError('permission-denied', 'User must be an admin.');
  // }
  console.warn("TODO: Implement proper admin check in ensureAdmin for form functions.");
};

exports.createFormSchema = functions.https.onCall(async (data, context) => {
  ensureAdmin(context); // Use ensureAdmin or ensureAuthenticated
  const { formName, description, fields } = data;
  const adminUserId = context.auth.uid;

  if (!formName || !fields || !Array.isArray(fields) || fields.length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required fields: formName and a non-empty fields array.'
    );
  }
  // Basic validation for each field
  for (const field of fields) {
    if (!field.fieldId || !field.label || !field.type) {
      throw new functions.https.HttpsError('invalid-argument', 'Each field must have fieldId, label, and type.');
    }
  }

  try {
    const newFormRef = await db.collection('eventForms').add({
      formName,
      description: description || null,
      fields,
      adminUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const newForm = await newFormRef.get();
    return { id: newForm.id, ...newForm.data() };
  } catch (error) {
    console.error("Error creating form schema:", error);
    throw new functions.https.HttpsError('internal', 'Could not create form schema.', error.message);
  }
});

exports.getFormSchema = functions.https.onCall(async (data, context) => {
  // ensureAdmin(context); // Or ensureAuthenticated, depending on if schemas can be read by non-admins
  const { formId } = data;
  if (!formId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing formId.');
  }
  try {
    const formDoc = await db.collection('eventForms').doc(formId).get();
    if (!formDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Form schema not found.');
    }
    // Optional: Check if user has permission to read this form if not public
    return { id: formDoc.id, ...formDoc.data() };
  } catch (error) {
    console.error("Error getting form schema:", error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Could not fetch form schema.', error.message);
  }
});

exports.listFormSchemas = functions.https.onCall(async (data, context) => {
  ensureAdmin(context); // Typically admin-only
  const adminUserId = context.auth.uid; // To list forms created by this admin
  try {
    // List forms created by the current admin, or all forms if that's the desired logic
    const querySnapshot = await db.collection('eventForms')
                                  // .where('adminUserId', '==', adminUserId) // Uncomment to list user's own forms
                                  .orderBy('createdAt', 'desc')
                                  .get();
    const forms = querySnapshot.docs.map(doc => ({ 
      id: doc.id, 
      formName: doc.data().formName, 
      description: doc.data().description,
      fieldCount: doc.data().fields.length
    }));
    return forms;
  } catch (error) {
    console.error("Error listing form schemas:", error);
    throw new functions.https.HttpsError('internal', 'Could not list form schemas.', error.message);
  }
});

exports.updateFormSchema = functions.https.onCall(async (data, context) => {
  ensureAdmin(context);
  const { formId, ...formData } = data;
  const adminUserId = context.auth.uid;

  if (!formId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing formId.');
  }
  if (Object.keys(formData).length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'No data provided for update.');
  }
  // Add validation for formData.fields if present

  const formRef = db.collection('eventForms').doc(formId);
  try {
    const doc = await formRef.get();
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'Form schema not found.');
    }
    if (doc.data().adminUserId !== adminUserId) {
      // Optional: Strict ownership check. Remove if admins can edit any form.
      throw new functions.https.HttpsError('permission-denied', 'User does not own this form schema.');
    }
    await formRef.update({
      ...formData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const updatedDoc = await formRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  } catch (error) {
    console.error("Error updating form schema:", error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Could not update form schema.', error.message);
  }
});

exports.deleteFormSchema = functions.https.onCall(async (data, context) => {
  ensureAdmin(context);
  const { formId } = data;
  const adminUserId = context.auth.uid;

  if (!formId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing formId.');
  }
  const formRef = db.collection('eventForms').doc(formId);
  try {
    const doc = await formRef.get();
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'Form schema not found.');
    }
    if (doc.data().adminUserId !== adminUserId) {
      // Optional: Strict ownership check
      throw new functions.https.HttpsError('permission-denied', 'User does not own this form schema.');
    }
    // Before deleting, check if any event uses this formId.
    // This requires querying the 'events' collection.
    const eventsUsingForm = await db.collection('events').where('formId', '==', formId).limit(1).get();
    if (!eventsUsingForm.isEmpty) {
        throw new functions.https.HttpsError('failed-precondition', 'Cannot delete form schema. It is currently in use by one or more events.');
    }

    await formRef.delete();
    return { message: `Form schema ${formId} deleted successfully.` };
  } catch (error) {
    console.error("Error deleting form schema:", error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Could not delete form schema.', error.message);
  }
});
