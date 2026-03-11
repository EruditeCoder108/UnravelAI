async function createBooking(userId, roomId, startDate, endDate) {
    const response = await fetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ userId, roomId, startDate, endDate })
    });
    return response.json();
}

async function handleBookingSubmit(formData) {
    const booking = await createBooking(
        formData.roomId,
        formData.userId,
        formData.checkIn,
        formData.checkOut
    );
    return booking;
}
