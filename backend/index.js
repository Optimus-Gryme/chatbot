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

// --- Google Calendar OAuth Functions ---

const { google } = require('googleapis');

// TODO: User must replace these with their actual credentials from Google Cloud Console
// It's highly recommended to store these as Firebase environment configuration
// (e.g., functions.config().google.client_id) rather than hardcoding.
// For this subtask, worker will use placeholders.
const GOOGLE_CLIENT_ID = functions.config().google?.client_id || 'YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER';
const GOOGLE_CLIENT_SECRET = functions.config().google?.client_secret || 'YOUR_GOOGLE_CLIENT_SECRET_PLACEHOLDER';

// This should be the full URL of the googleCalendarOAuthCallback function deployed on Firebase.
// e.g., https://us-central1-your-project-id.cloudfunctions.net/googleCalendarOAuthCallback
// Worker will use a placeholder. User needs to configure this in GCP Console and update here.
const REDIRECT_URI = functions.config().google?.redirect_uri || 'YOUR_CALLBACK_FUNCTION_URL_PLACEHOLDER/googleCalendarOAuthCallback';


const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

exports.getGoogleCalendarAuthUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to authorize Google Calendar.');
  }
  // TODO: Add admin role check here if desired (ensureAdmin)

  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email' // To verify identity
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // To get a refresh token
    scope: scopes,
    // A unique string for the user to prevent CSRF attacks.
    // Can be stored in Firestore temporarily and verified in callback. For simplicity, not implemented here.
    // state: 'some_random_state_string_for_user_' + context.auth.uid 
  });

  return { authUrl };
});

exports.googleCalendarOAuthCallback = functions.https.onRequest(async (req, res) => {
  // This function is an HTTP onRequest function, not onCall, because Google redirects here.
  const code = req.query.code;
  const state = req.query.state; // If you use state, verify it here.

  if (!code) {
    res.status(400).send('Authorization code is missing.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user's Google email to confirm identity (optional but good practice)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const googleUserInfo = await oauth2.userinfo.get();
    const googleEmail = googleUserInfo.data.email;

    // IMPORTANT: How to get Firebase UID here?
    // The challenge with a simple redirect is associating the OAuth callback with the Firebase user
    // who initiated it. Common solutions:
    // 1. Pass Firebase UID in the 'state' parameter (encrypted or as a temporary key).
    // 2. Have the client make a call to a different Firebase function *after* Google redirects
    //    back to the client, passing the 'code'. That function then runs this logic.
    // For this subtask, we'll assume the 'state' parameter contains the Firebase UID.
    // THIS IS A SIMPLIFICATION AND REQUIRES THE CLIENT TO GENERATE AND PASS THE UID IN STATE.
    // A more robust solution would involve a session or temporary token.

    // Let's assume `state` parameter contains the Firebase UID.
    // The client that calls `getGoogleCalendarAuthUrl` would need to generate a state
    // string that includes the UID, and then pass it to the authUrl.
    // e.g., const stateValue = `uid=${context.auth.uid}&csrf=${randomToken}`
    // This is a simplified approach.
    
    // For the worker: Assume the 'state' parameter is the Firebase UID.
    // In a real app, 'state' should be more secure and include a CSRF token.
    const firebaseUid = state; 
    if (!firebaseUid) {
        // This is a critical part. If UID is not in state, we can't save the token correctly.
        // For now, log an error. A real implementation MUST solve this.
        console.error("CRITICAL: Firebase UID not found in state. Cannot save token for user.");
        res.status(400).send('State parameter missing or does not contain Firebase UID. Cannot associate token.');
        return;
    }


    // Store tokens securely in Firestore, associated with the Firebase UID.
    // Collection: 'adminGoogleTokens', Document ID: firebaseUid
    await db.collection('adminGoogleTokens').doc(firebaseUid).set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token, // Crucial for long-term access
      expiryDate: tokens.expiry_date,
      scope: tokens.scope,
      googleEmail: googleEmail, // Store the Google email for reference
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    // Redirect user to a success page or back to the admin dashboard
    // For now, just send a success message.
    res.status(200).send('Google Calendar authorization successful! Tokens stored. You can close this tab.');

  } catch (error) {
    console.error('Error during Google OAuth callback:', error.message, error.stack);
    res.status(500).send('Failed to authorize Google Calendar. ' + error.message);
  }
});

// Helper function to get a user's valid OAuth2 client (using refresh token if needed)
// This will be used by functions that need to interact with Google Calendar API.
async function getAuthenticatedOAuth2Client(firebaseUid) {
  const tokenDoc = await db.collection('adminGoogleTokens').doc(firebaseUid).get();
  if (!tokenDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Google Calendar tokens not found for this user. Please re-authorize.');
  }

  const tokens = tokenDoc.data();
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiryDate,
  });

  // Check if token is expired or close to expiring (e.g., within 5 minutes)
  if (new Date(tokens.expiryDate) < new Date(Date.now() + 5 * 60 * 1000)) {
    console.log(`Token for UID ${firebaseUid} is expired or expiring soon. Refreshing...`);
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      // Update stored tokens with the new ones (especially access_token and expiry_date)
      await db.collection('adminGoogleTokens').doc(firebaseUid).update({
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date,
        scope: credentials.scope || tokens.scope, // Keep original scope if new one isn't provided
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Token refreshed and updated for UID ${firebaseUid}.`);
    } catch (refreshError) {
      console.error(`Failed to refresh token for UID ${firebaseUid}:`, refreshError);
      // If refresh fails, the user might need to re-authorize completely.
      // Delete the stored token to force re-auth? Or mark as invalid?
      await db.collection('adminGoogleTokens').doc(firebaseUid).update({ refreshToken: null, needsReauth: true }); // Invalidate
      throw new functions.https.HttpsError('permission-denied', 'Failed to refresh Google token. Please re-authorize.', refreshError.message);
    }
  }
  return client;
}

// --- Nodemailer Email Confirmation Function ---

const nodemailer = require('nodemailer');

// Email configuration (placeholders if not set in Firebase config)
const EMAIL_HOST = functions.config().email?.host || 'YOUR_SMTP_HOST';
const EMAIL_PORT = functions.config().email?.port || 587;
const EMAIL_USER = functions.config().email?.user || 'YOUR_EMAIL_USER';
const EMAIL_PASS = functions.config().email?.pass || 'YOUR_EMAIL_PASS';
const EMAIL_FROM = functions.config().email?.from_address || 'noreply@example.com';


// Nodemailer transporter setup
// Only create transporter if host is not the placeholder, otherwise it will fail on deploy.
let transporter;
if (EMAIL_HOST !== 'YOUR_SMTP_HOST') {
    transporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: parseInt(EMAIL_PORT, 10), // Ensure port is an integer
        secure: parseInt(EMAIL_PORT, 10) === 465, // true for 465, false for other ports
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });
} else {
    console.warn("SMTP host not configured. Email sending will be disabled.");
}


exports.sendBookingConfirmationEmail = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    if (!transporter) {
        console.log("Email transporter not configured. Skipping email for booking:", context.params.bookingId);
        return null;
    }

    const bookingData = snap.data();

    // Fetch event details for more context in email
    let eventData = null;
    try {
        // Ensure db is defined and initialized. Assuming it's defined earlier in the file.
        const eventDoc = await db.collection('events').doc(bookingData.eventId).get();
        if (eventDoc.exists) {
            eventData = eventDoc.data();
        } else {
            console.error(`Event ${bookingData.eventId} not found for booking ${context.params.bookingId}.`);
        }
    } catch (error) {
        console.error(`Error fetching event ${bookingData.eventId} for booking ${context.params.bookingId}:`, error);
    }

    const guestEmail = bookingData.guestEmail;
    const guestName = bookingData.guestName;
    const eventTitle = eventData?.title || bookingData.eventTitle || 'the event';
    const eventStartDate = eventData?.start ? new Date(eventData.start).toLocaleString() : 'N/A';

    // Email content
    const mailOptions = {
        from: `"HuiBook Bookings" <${EMAIL_FROM}>`,
        to: guestEmail,
        subject: `Your Booking Confirmation for ${eventTitle}`,
        html: `
            <p>Kia ora ${guestName},</p>
            <p>Thank you for your booking for <strong>${eventTitle}</strong> scheduled for ${eventStartDate}.</p>
            <p>Your booking details:</p>
            <ul>
                <li>Event: ${eventTitle}</li>
                <li>Booked by: ${guestName} (${guestEmail})</li>
                <li>Attendees: ${bookingData.numberOfAttendees || 1}</li>
                ${bookingData.bookingNotes ? `<li>Notes: ${bookingData.bookingNotes}</li>` : ''}
            </ul>
            ${bookingData.formSubmissionData ? 
                '<p>Additional Information Provided:</p><ul>' +
                Object.entries(bookingData.formSubmissionData).map(([key, value]) => `<li>${key.replace(/_/g, ' ')}: ${value}</li>`).join('') +
                '</ul>' 
                : ''
            }
            <p>We look forward to seeing you!</p>
            <p>Ngā mihi,<br>The HuiBook Team</p>
        `,
    };

    try {
        console.log(`Attempting to send booking confirmation to ${guestEmail} for booking ${context.params.bookingId}`);
        await transporter.sendMail(mailOptions);
        console.log(`Booking confirmation email sent successfully to ${guestEmail} for booking ${context.params.bookingId}.`);
        return null;
    } catch (error) {
        console.error(`Failed to send booking confirmation email to ${guestEmail} for booking ${context.params.bookingId}:`, error);
        // Optional: Update booking document with email_failed: true status for retry or admin attention
        // await snap.ref.update({ emailSendStatus: 'failed', emailSendError: error.message });
        return null; // Don't crash the function, just log error
    }
});

// --- Admin Notification on New Booking ---

// Admin Email Configuration
const ADMIN_NOTIFICATION_EMAIL = functions.config().admin?.notification_email || 'admin-fallback@example.com'; // Fallback for safety

exports.notifyAdminOnNewBooking = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    if (!transporter) {
        console.log("Email transporter not configured. Skipping admin notification for booking:", context.params.bookingId);
        return null;
    }
    if (ADMIN_NOTIFICATION_EMAIL === 'admin-fallback@example.com') {
        console.warn("Admin notification email not configured in functions.config().admin.notification_email. Skipping admin notification.");
        return null;
    }

    const bookingData = snap.data();
    const bookingId = context.params.bookingId;

    // Fetch event details for more context in email
    let eventData = null;
    try {
        const eventDoc = await db.collection('events').doc(bookingData.eventId).get();
        if (eventDoc.exists) {
            eventData = eventDoc.data();
        } else {
            console.error(`[Admin Notify] Event ${bookingData.eventId} not found for booking ${bookingId}.`);
        }
    } catch (error) {
        console.error(`[Admin Notify] Error fetching event ${bookingData.eventId} for booking ${bookingId}:`, error);
    }

    const guestEmail = bookingData.guestEmail;
    const guestName = bookingData.guestName;
    const eventTitle = eventData?.title || bookingData.eventTitle || 'N/A';
    const eventStartDate = eventData?.start ? new Date(eventData.start).toLocaleString() : 'N/A';

    // Email content for Admin
    const mailOptions = {
        from: `"HuiBook System" <${EMAIL_FROM}>`, // Using EMAIL_FROM from previous setup
        to: ADMIN_NOTIFICATION_EMAIL,
        subject: `New Booking Received for ${eventTitle} (ID: ${bookingId})`,
        html: `
            <p>Kia ora Admin,</p>
            <p>A new booking has been submitted for the event: <strong>${eventTitle}</strong>.</p>
            <p>Booking Details (ID: ${bookingId}):</p>
            <ul>
                <li>Event: ${eventTitle}</li>
                <li>Scheduled Start: ${eventStartDate}</li>
                <li>Booked by: ${guestName} (${guestEmail})</li>
                <li>Attendees: ${bookingData.numberOfAttendees || 1}</li>
                ${bookingData.bookingNotes ? `<li>Notes: ${bookingData.bookingNotes}</li>` : ''}
            </ul>
            ${bookingData.formSubmissionData ? 
                '<p>Custom Form Data Submitted:</p><ul>' +
                Object.entries(bookingData.formSubmissionData).map(([key, value]) => `<li>${key.replace(/_/g, ' ')}: ${value}</li>`).join('') +
                '</ul>' 
                : ''
            }
            <p>You can view and manage this booking in the HuiBook Admin Dashboard.</p>
            <p>Ngā mihi,<br>The HuiBook System</p>
        `,
    };

    try {
        console.log(`Attempting to send admin notification to ${ADMIN_NOTIFICATION_EMAIL} for booking ${bookingId}`);
        await transporter.sendMail(mailOptions);
        console.log(`Admin notification email sent successfully for booking ${bookingId}.`);
        return null;
    } catch (error) {
        console.error(`Failed to send admin notification email for booking ${bookingId}:`, error);
        return null; // Don't crash function
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
  const { eventId, guestName, guestEmail, numberOfAttendees, bookingNotes, formSubmissionData } = data; // Added formSubmissionData
  let userId = null;
  if (context.auth) {
    userId = context.auth.uid;
  }

  // Existing validation for eventId, guestName, guestEmail
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
      formSubmissionData: formSubmissionData || null, // Save the dynamic form data
    });
    const newBooking = await newBookingRef.get();
    // return { id: newBooking.id, ...newBooking.data() }; // Modified to return after GCal sync

    const createdBookingData = { id: newBooking.id, ...newBooking.data() };

    // --- Start Google Calendar Sync ---
    let eventAdminUid; // Define eventAdminUid here to be accessible in the final catch block
    try {
      const eventDoc = await db.collection('events').doc(createdBookingData.eventId).get();
      if (!eventDoc.exists) {
        console.error(`[GCal Sync] Event ${createdBookingData.eventId} not found. Cannot sync booking ${createdBookingData.id}.`);
        return createdBookingData; 
      }

      const eventData = eventDoc.data();
      eventAdminUid = eventData.userId; // Assign eventAdminUid

      if (!eventAdminUid) {
        console.log(`[GCal Sync] Event ${eventData.title} does not have an associated admin UID. Skipping calendar sync for booking ${createdBookingData.id}.`);
        return createdBookingData;
      }

      const tokenSnapshot = await db.collection('adminGoogleTokens').doc(eventAdminUid).get();
      if (!tokenSnapshot.exists || !tokenSnapshot.data().refreshToken) {
        console.log(`[GCal Sync] Admin ${eventAdminUid} has not authorized Google Calendar or no refresh token. Skipping sync for booking ${createdBookingData.id}.`);
        return createdBookingData;
      }

      console.log(`[GCal Sync] Attempting to sync booking ${createdBookingData.id} to admin ${eventAdminUid}'s calendar.`);
      const oauthClient = await getAuthenticatedOAuth2Client(eventAdminUid);
      const calendar = google.calendar({ version: 'v3', auth: oauthClient });

      let dynamicFormDataString = '';
      if (createdBookingData.formSubmissionData) {
        dynamicFormDataString = "\n\nCustom Form Data:\n";
        for (const [key, value] of Object.entries(createdBookingData.formSubmissionData)) {
          dynamicFormDataString += `${key.replace(/_/g, ' ')}: ${value}\n`;
        }
      }

      const calendarEventResource = {
        summary: `Booking: ${eventData.title} by ${createdBookingData.guestName}`,
        description: `Booked via HuiBook.\nEvent: ${eventData.title}\nBooker: ${createdBookingData.guestName} (${createdBookingData.guestEmail})\nAttendees: ${createdBookingData.numberOfAttendees || 1}${createdBookingData.bookingNotes ? '\nNotes: ' + createdBookingData.bookingNotes : ''}${dynamicFormDataString}`,
        start: {
          dateTime: new Date(eventData.start).toISOString(),
          timeZone: 'UTC', 
        },
        end: {
          dateTime: new Date(eventData.end).toISOString(),
          timeZone: 'UTC',
        },
        // attendees: [{ email: createdBookingData.guestEmail }], 
      };

      await calendar.events.insert({
        calendarId: 'primary',
        resource: calendarEventResource,
      });
      console.log(`[GCal Sync] Booking ${createdBookingData.id} successfully synced to admin ${eventAdminUid}'s Google Calendar.`);

    } catch (gcalError) {
      console.error(`[GCal Sync] Failed to sync booking ${createdBookingData.id} to Google Calendar for admin ${eventAdminUid}:`, gcalError.message);
    }
    // --- End Google Calendar Sync ---

    return createdBookingData;

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
