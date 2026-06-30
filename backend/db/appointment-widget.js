(function () {
  const pageName = window.location.pathname.split('/').pop() || '';
  const excludedPages = new Set(['admin.html', 'mentor.html', 'psychologist.html']);
  if (excludedPages.has(pageName)) return;

  const widgetHtml = `
    <button id="bookAppointmentFab" class="appointment-fab" type="button" aria-label="Book appointment">
      Book Appointment
    </button>

    <div id="appointmentModal" class="modal-overlay appointment-overlay" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="appointmentModalTitle">
      <div class="modal appointment-modal">
        <div class="modal-header">
          <p class="modal-eyebrow">Appointments</p>
          <h2 id="appointmentModalTitle" class="modal-title">Book with your therapist</h2>
          <p class="modal-subtitle">Choose an available slot. Unavailable slots are disabled.</p>
        </div>

        <div class="appointment-controls">
          <div class="form-group">
            <label class="form-label" for="therapistType">Therapist role</label>
            <select id="therapistType" class="form-select">
              <option value="mentor">Mentor</option>
              <option value="psychiatrist">Psychologist</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="therapistId">Assigned therapist</label>
            <select id="therapistId" class="form-select"></select>
          </div>
          <div class="form-group">
            <label class="form-label" for="appointmentDate">Pick date</label>
            <input id="appointmentDate" class="form-input" type="date" />
          </div>
          <div class="form-group">
            <label class="form-label" for="appointmentTime">Preferred time</label>
            <input id="appointmentTime" class="form-input" type="time" step="900" />
          </div>
        </div>

        <div class="appointment-legend" aria-label="Slot meaning">
          <span class="appointment-legend-item"><span class="slot-dot slot-dot-available"></span>Available</span>
          <span class="appointment-legend-item"><span class="slot-dot slot-dot-taken"></span>Taken</span>
        </div>

        <div id="appointmentCalendar" class="appointment-calendar" aria-live="polite"></div>
        <p id="appointmentFeedback" class="appointment-feedback" aria-live="polite"></p>
        <div id="googleCalendarActions" class="modal-actions" style="margin-top:10px; display:none;"></div>

        <div class="modal-actions">
          <button id="closeAppointmentModal" class="btn-ghost-modal" type="button">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', widgetHtml);

  const bookAppointmentFab = document.getElementById('bookAppointmentFab');
  const appointmentModal = document.getElementById('appointmentModal');
  const closeAppointmentModal = document.getElementById('closeAppointmentModal');
  const therapistTypeInput = document.getElementById('therapistType');
  const therapistIdInput = document.getElementById('therapistId');
  const appointmentDateInput = document.getElementById('appointmentDate');
  const appointmentTimeInput = document.getElementById('appointmentTime');
  const appointmentCalendar = document.getElementById('appointmentCalendar');
  const appointmentFeedback = document.getElementById('appointmentFeedback');
  const googleCalendarActions = document.getElementById('googleCalendarActions');
  let resolvedStudentId = null;
  let availabilityPollId = null;

  function todayYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentHm() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function hhmmToMinutes(value) {
    if (!value || !value.includes(':')) return null;
    const [hours, minutes] = value.split(':').map((part) => Number(part));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return (hours * 60) + minutes;
  }

  function minutesToHm(minutes) {
    const safe = Math.max(0, Math.min(24 * 60, minutes));
    const hours = String(Math.floor(safe / 60)).padStart(2, '0');
    const mins = String(safe % 60).padStart(2, '0');
    return `${hours}:${mins}`;
  }

  function addDays(ymd, days) {
    const date = new Date(`${ymd}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function getWorkingWindowByDate(ymd) {
    if (!ymd) return null;
    const date = new Date(`${ymd}T00:00:00`);
    const day = date.getDay();

    if (day === 0) return null; // Sunday closed
    if (day === 6) {
      return { min: '09:00', max: '12:00', label: 'Saturday 09:00-12:00' };
    }
    return { min: '08:00', max: '17:00', label: 'Monday-Friday 08:00-17:00' };
  }

  function ensureDateWithinWorkingDays() {
    if (!appointmentDateInput.value) return false;

    let date = appointmentDateInput.value;
    let window = getWorkingWindowByDate(date);
    if (window) return false;

    // If Sunday is selected, move to Monday.
    date = addDays(date, 1);
    appointmentDateInput.value = date;
    appointmentFeedback.textContent = 'Sunday is unavailable. Shifted to the next available day.';
    return true;
  }

  function applyWorkingWindowToTimeInput() {
    const selectedDate = appointmentDateInput.value;
    const window = getWorkingWindowByDate(selectedDate);
    if (!window) {
      appointmentTimeInput.min = '';
      appointmentTimeInput.max = '';
      return null;
    }

    appointmentTimeInput.min = window.min;
    appointmentTimeInput.max = window.max;

    const selectedMinutes = hhmmToMinutes(appointmentTimeInput.value);
    const minMinutes = hhmmToMinutes(window.min);
    const maxMinutes = hhmmToMinutes(window.max);

    if (selectedMinutes == null || selectedMinutes < minMinutes) {
      appointmentTimeInput.value = window.min;
    }
    if (selectedMinutes != null && selectedMinutes > maxMinutes) {
      appointmentTimeInput.value = window.max;
    }

    return window;
  }

  function toGoogleDateTime(dateInput) {
    const date = new Date(dateInput);
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function buildGoogleCalendarUrl({ startAt, endAt, therapistType, therapistId }) {
    const text = 'Tuliza Therapy Appointment';
    const details = `Therapist type: ${therapistType}, Therapist ID: ${therapistId}`;
    const dates = `${toGoogleDateTime(startAt)}/${toGoogleDateTime(endAt)}`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text,
      details,
      dates,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function hideGoogleCalendarAction() {
    googleCalendarActions.style.display = 'none';
    googleCalendarActions.innerHTML = '';
  }

  async function parseJsonResponse(response, fallbackMessage) {
    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        const trimmed = text.trim().toLowerCase();
        if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
          throw new Error('API returned HTML instead of JSON. Start backend and open pages via http://localhost:3000, not Live Server.');
        }
        throw new Error('Server returned a non-JSON response. Please restart backend and try again.');
      }
    }

    if (!response.ok) {
      throw new Error((payload && payload.error) || fallbackMessage);
    }

    return payload || {};
  }

  function stopAvailabilityPolling() {
    if (availabilityPollId) {
      clearInterval(availabilityPollId);
      availabilityPollId = null;
    }
  }

  function startAvailabilityPolling() {
    stopAvailabilityPolling();
    availabilityPollId = setInterval(() => {
      if (appointmentModal.style.display === 'flex') {
        loadAvailability();
      }
    }, 15000);
  }

  function getSessionUser() {
    try {
      const raw = localStorage.getItem('tuliza_session_user');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function getStudentIdentityCandidate() {
    const session = getSessionUser();
    if (session && session.role === 'student' && session.alias) return session.alias;

    try {
      const signupRaw = localStorage.getItem('tuliza_signup_user');
      if (!signupRaw) return null;
      const signup = JSON.parse(signupRaw);
      if (signup && signup.role === 'student' && signup.alias) return signup.alias;
    } catch (_) {
      return null;
    }

    return null;
  }

  async function resolveStudentIdFromSession() {
    const identifier = getStudentIdentityCandidate();
    if (!identifier) {
      resolvedStudentId = null;
      appointmentFeedback.textContent = 'Login as a student on the Account page to book appointments.';
      return;
    }

    const response = await fetch(`/api/users/resolve-id?role=student&identifier=${encodeURIComponent(identifier)}`);
    const payload = await parseJsonResponse(response, 'Could not resolve your student account.');
    if (!payload.userId) {
      throw new Error('Could not resolve your student account.');
    }

    resolvedStudentId = Number(payload.userId);
  }

  async function loadTherapists() {
    const therapistType = therapistTypeInput.value;
    therapistIdInput.innerHTML = '';

    const response = await fetch(`/api/therapists?type=${encodeURIComponent(therapistType)}`);
    const payload = await parseJsonResponse(response, 'Could not load therapists.');

    const optionsHtml = (payload.therapists || [])
      .map((therapist) => `<option value="${therapist.therapistId}">${therapist.displayName} (#${therapist.therapistId})</option>`)
      .join('');

    therapistIdInput.innerHTML = optionsHtml;
    if (!optionsHtml) {
      appointmentFeedback.textContent = 'No therapists found for this role yet.';
    }
  }

  function closeModal() {
    appointmentModal.style.display = 'none';
    hideGoogleCalendarAction();
    stopAvailabilityPolling();
  }

  async function loadAvailability() {
    const therapistType = therapistTypeInput.value;
    const therapistId = Number(therapistIdInput.value);
    if (!therapistType || !therapistId) {
      appointmentFeedback.textContent = 'Please choose a therapist.';
      return;
    }

    const minimumDate = todayYmd();
    if (appointmentDateInput.value && appointmentDateInput.value < minimumDate) {
      appointmentDateInput.value = minimumDate;
      appointmentFeedback.textContent = 'Past dates are not allowed. Showing today onward.';
    }

    if (ensureDateWithinWorkingDays()) {
      // Date changed from Sunday to Monday, continue with updated value.
    }

    const window = applyWorkingWindowToTimeInput();

    if (appointmentDateInput.value === minimumDate && appointmentTimeInput.value && appointmentTimeInput.value < currentHm()) {
      appointmentTimeInput.value = currentHm();
      appointmentFeedback.textContent = 'Past times are not allowed for today. Showing upcoming time slots.';
    }

    const correctedCurrentTime = hhmmToMinutes(currentHm());
    if (appointmentDateInput.value === minimumDate && window) {
      const minMinutes = hhmmToMinutes(window.min);
      const maxMinutes = hhmmToMinutes(window.max);
      if (correctedCurrentTime > maxMinutes) {
        appointmentCalendar.innerHTML = '';
        appointmentFeedback.textContent = `Booking hours are over for today (${window.label}). Please choose another date.`;
        return;
      }

      if (correctedCurrentTime > minMinutes && hhmmToMinutes(appointmentTimeInput.value) < correctedCurrentTime) {
        appointmentTimeInput.value = minutesToHm(correctedCurrentTime);
      }
    }

    appointmentFeedback.textContent = 'Loading therapist availability...';
    appointmentCalendar.innerHTML = '';
    hideGoogleCalendarAction();

    try {
      const selectedDate = appointmentDateInput.value;
      const datePart = selectedDate ? `&startDate=${encodeURIComponent(selectedDate)}&days=1` : '&days=14';
      const response = await fetch(`/api/appointments/availability?therapistType=${encodeURIComponent(therapistType)}&therapistId=${encodeURIComponent(String(therapistId))}${datePart}`);
      const data = await parseJsonResponse(response, 'Could not load availability.');
      const summary = renderCalendar(data.slots || []);
      const timeSuffix = summary.timeFilter ? `from ${summary.timeFilter}` : 'for the selected date';
      appointmentFeedback.textContent = `Available: ${summary.available} | Taken: ${summary.taken} ${timeSuffix}. Select any available slot to book.`;
    } catch (err) {
      appointmentFeedback.textContent = err.message || 'Failed to load availability.';
    }
  }

  function renderCalendar(slots) {
    const selectedTime = appointmentTimeInput.value;
    const selectedMinutes = hhmmToMinutes(selectedTime);
    const window = getWorkingWindowByDate(appointmentDateInput.value);
    const windowStart = window ? hhmmToMinutes(window.min) : null;
    const windowEnd = window ? hhmmToMinutes(window.max) : null;
    const filteredSlots = selectedMinutes == null
      ? slots
      : slots.filter((slot) => {
        const start = new Date(slot.startAt);
        const end = new Date(slot.endAt);
        const startMinutes = (start.getHours() * 60) + start.getMinutes();
        const endMinutes = (end.getHours() * 60) + end.getMinutes();
        const inTimeFilter = startMinutes >= selectedMinutes;
        const inWorkingWindow = windowStart == null || windowEnd == null
          ? true
          : (startMinutes >= windowStart && endMinutes <= windowEnd);
        return inTimeFilter && inWorkingWindow;
      });

    if (!filteredSlots.length) {
      appointmentCalendar.innerHTML = '<p class="appointment-empty">No upcoming slots found. Ask the therapist to publish availability.</p>';
      return { available: 0, taken: 0, timeFilter: selectedTime };
    }

    let availableCount = 0;
    let takenCount = 0;

    const grouped = new Map();
    filteredSlots.forEach((slot) => {
      const slotDate = new Date(slot.startAt);
      const dayKey = slotDate.toISOString().slice(0, 10);
      if (!grouped.has(dayKey)) grouped.set(dayKey, []);
      grouped.get(dayKey).push(slot);
    });

    const dayCards = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, daySlots]) => {
        const dateLabel = new Date(`${dayKey}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });

        const slotButtons = daySlots
          .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
          .map((slot) => {
            const startLabel = new Date(slot.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endLabel = new Date(slot.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const unavailable = slot.status !== 'available';
              if (unavailable) takenCount += 1;
              else availableCount += 1;
              const statusLabel = unavailable ? 'Taken' : 'Available';
            return `
              <button
                class="slot-chip ${unavailable ? 'is-unavailable' : 'is-available'}"
                ${unavailable ? 'disabled' : ''}
                data-availability-id="${slot.availabilityId}"
                aria-label="${startLabel} to ${endLabel}, ${statusLabel}"
              >
                ${startLabel} - ${endLabel} ${unavailable ? '(Taken)' : '(Available)'}
              </button>
            `;
          })
          .join('');

        return `
          <article class="appointment-day-card">
            <h3>${dateLabel}</h3>
            <div class="slot-grid">${slotButtons}</div>
          </article>
        `;
      })
      .join('');

    appointmentCalendar.innerHTML = dayCards;

    appointmentCalendar.querySelectorAll('.slot-chip.is-available').forEach((button) => {
      button.addEventListener('click', async () => {
        const availabilityId = Number(button.getAttribute('data-availability-id'));
        await bookSlot(availabilityId);
      });
    });

    return { available: availableCount, taken: takenCount, timeFilter: selectedTime };
  }

  async function bookSlot(availabilityId) {
    const therapistType = therapistTypeInput.value;
    const therapistId = Number(therapistIdInput.value);
    const studentId = Number(resolvedStudentId);

    if (!therapistType || !therapistId || !studentId || !availabilityId) {
      appointmentFeedback.textContent = 'Student and therapist accounts must be resolved before booking.';
      return;
    }

    appointmentFeedback.textContent = 'Booking slot...';
    hideGoogleCalendarAction();

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          therapistType,
          therapistId,
          availabilityId,
        }),
      });

      const result = await parseJsonResponse(response, 'Booking failed.');

      await loadAvailability();
      appointmentFeedback.textContent = `Booked successfully. Slot starts at ${new Date(result.slotStart).toLocaleString()}.`;
      const googleUrl = buildGoogleCalendarUrl({
        startAt: result.slotStart,
        endAt: result.slotEnd,
        therapistType,
        therapistId,
      });
      googleCalendarActions.innerHTML = `<a class="btn-primary" href="${googleUrl}" target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>`;
      googleCalendarActions.style.display = 'flex';
    } catch (err) {
      appointmentFeedback.textContent = err.message || 'Could not complete booking.';
      hideGoogleCalendarAction();
    }
  }

  function openAppointmentModal() {
    appointmentModal.style.display = 'flex';
    (async () => {
      appointmentFeedback.textContent = 'Preparing booking options...';
      try {
        if (!appointmentDateInput.value) {
          appointmentDateInput.value = todayYmd();
        }
        if (!appointmentTimeInput.value) {
          appointmentTimeInput.value = currentHm();
        }
        appointmentDateInput.min = todayYmd();
        ensureDateWithinWorkingDays();
        applyWorkingWindowToTimeInput();
        await resolveStudentIdFromSession();
        await loadTherapists();
        await loadAvailability();
        startAvailabilityPolling();
      } catch (err) {
        appointmentFeedback.textContent = err.message || 'Could not prepare booking options.';
      }
    })();
  }

  bookAppointmentFab.addEventListener('click', openAppointmentModal);
  closeAppointmentModal.addEventListener('click', closeModal);
  appointmentModal.addEventListener('click', (event) => {
    if (event.target === appointmentModal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appointmentModal.style.display === 'flex') {
      closeModal();
    }
  });

  therapistTypeInput.addEventListener('change', async () => {
    try {
      await loadTherapists();
      await loadAvailability();
    } catch (err) {
      appointmentFeedback.textContent = err.message || 'Could not load therapist options.';
    }
  });
  therapistIdInput.addEventListener('change', loadAvailability);
  appointmentDateInput.addEventListener('change', loadAvailability);
  appointmentTimeInput.addEventListener('change', loadAvailability);
})();
