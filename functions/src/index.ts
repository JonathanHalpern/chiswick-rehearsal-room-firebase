import * as functions from "firebase-functions";
import * as moment from "moment";

const admin = require("firebase-admin");

admin.initializeApp(functions.config().firebase);

const db = admin.firestore();

const key = functions.config().horizontal.secret;

const checkIfAdmin = token =>
  new Promise((resolve, reject) => {
    if (token) {
      admin
        .auth()
        .verifyIdToken(token)
        .then(function(decodedToken) {
          const isAdmin = decodedToken.admin;
          if (isAdmin) {
            resolve();
          } else {
            reject();
          }
        })
        .catch(function(error) {
          console.log("couldnt decode");
          reject();
        });
    } else {
      reject();
    }
  });

const checkIfSlotIsAvailable = ({
  startTime,
  endTime,
  bookingDate,
  bookingId
}) =>
  new Promise((resolve, reject) => {
    const newBookingStartTime = moment(startTime, "HH:mm");
    const newBookingEndTime = moment(endTime, "HH:mm");
    db.collection("bookings")
      .where("bookingDate", "==", bookingDate)
      .get()
      .then(function(querySnapshot) {
        querySnapshot.forEach(function(doc) {
          console.log(doc.id, " => ", doc.data());

          const existingBooking = doc.data();

          const existingBookingStartTime = moment(
            existingBooking.startTime,
            "HH:mm"
          );
          const existingBookingEndTime = moment(
            existingBooking.endTime,
            "HH:mm"
          );
          console.log(
            "compare",
            startTime,
            endTime,
            existingBooking.startTime,
            existingBooking.endTime
          );
          if (
            doc.id !== bookingId &&
            existingBooking.isConfirmed &&
            !(
              existingBookingEndTime.isSameOrBefore(newBookingStartTime) ||
              existingBookingStartTime.isSameOrAfter(newBookingEndTime)
            )
          ) {
            reject("slot is taken");
          }
        });
        resolve();
      })
      .catch(function(error) {
        console.log("Error getting documents: ", error);
      });
  });

const checkIfSlotsAreAvailable = slotsToCheck =>
  Promise.all(
    slotsToCheck.map(slotToCheck => checkIfSlotIsAvailable(slotToCheck))
  );

const addBooking = bookingObject => {
  console.log(bookingObject);

  const {
    name,
    email,
    phoneNumber = "not provided",
    bookingDate,
    startTime,
    endTime,
    message = "",
    price = "0",
    currency = "GBP",
    method = "unknown",
    isConfirmed
  } = bookingObject;

  const bookingCreationTime = Date.now();
  const adjustName = name.replace(/\s+/g, "-").toLowerCase();
  const bookingId = `${bookingCreationTime}-${adjustName}`;
  const docRef = db.collection("bookings").doc(bookingId);
  return docRef
    .set({
      name,
      email,
      phoneNumber,
      bookingDate,
      startTime,
      endTime,
      message,
      price,
      currency,
      method,
      isConfirmed,
      bookingCreationTime
    })
    .then(() => {
      console.log("Added document with ID: ", bookingId);
      !isConfirmed &&
        setTimeout(() => {
          docRef.get().then(doc => {
            if (doc.exists) {
              console.log("Document data:", doc.data());
              const data = doc.data();
              if (!data.isConfirmed) {
                docRef.delete();
              }
            } else {
              console.log("No such document!");
            }
          });
        }, 600000);
      console.info("track", bookingId);
      return { bookingId, bookingCreationTime };
    });
};

const addBookings = bookingObjects =>
  checkIfSlotsAreAvailable(bookingObjects).then(() =>
    Promise.all(bookingObjects.map(bookingObject => addBooking(bookingObject)))
  );

const editBooking = (bookingBody, res) => {
  console.log(bookingBody);

  const { bookingId, ...bookingObject } = bookingBody;
  const { startTime, endTime, bookingDate } = bookingObject;

  checkIfSlotIsAvailable({ startTime, endTime, bookingDate, bookingId }).then(
    () => {
      const docRef = db.collection("bookings").doc(bookingId);
      docRef.update(bookingObject).then(ref => {
        console.log("Updated document with ID: ", bookingId, ref);
        res.status(200).send(bookingId);
      });
    },
    err => {
      console.log(err);
      res.status(401).send(err);
    }
  );
};

export const createAdminBooking = functions.https.onRequest((req, res) => {
  if (req.method !== "POST") {
    res.status(403).send("Forbidden!");
  }

  const { token, ...bookingObject } = req.body;

  checkIfAdmin(token).then(
    () => {
      console.log("allowed");
      return checkIfSlotIsAvailable({
        ...bookingObject,
        bookingId: undefined
      }).then(
        () => {
          addBooking(bookingObject).then(
            response => {
              console.log("we got", response);
              res.status(200).send(response);
            },
            err => {
              console.log(err);
              res.status(401).send(err);
            }
          );
        },
        err => {
          console.log(err);
          res.status(401).send(err);
        }
      );
    },
    () => {
      res.status(403).send("You are not an admin");
    }
  );
});

export const editAdminBooking = functions.https.onRequest((req, res) => {
  if (req.method !== "POST") {
    res.status(403).send("Forbidden!");
  }

  const { token, ...bookingObject } = req.body;

  checkIfAdmin(token).then(
    () => {
      console.log("allowed");
      editBooking(bookingObject, res);
    },
    () => {
      res.status(403).send("You are not an admin");
    }
  );
});

export const createNewBookings = functions.https.onRequest((req, res) => {
  console.log("create new", req.body);
  if (req.headers.key !== key) {
    res.status(401).send("Not Authorized!");
  }

  if (req.method !== "POST") {
    res.status(403).send("Forbidden!");
  }

  const { selectedSlots, ...bookingInfo } = req.body;

  const bookingObjects = selectedSlots.map(slot => {
    return { ...slot, ...bookingInfo };
  });

  addBookings(bookingObjects).then(
    response => {
      console.log("we got", response);
      res.status(200).send(response);
    },
    err => {
      console.log(err);
      res.status(401).send(err);
    }
  );
});

const deleteTempBooking = bookingId => {
  const docRef = db.collection("bookings").doc(bookingId);

  return docRef.delete();
};

export const deleteTempBookings = functions.https.onRequest((req, res) => {
  if (req.headers.key !== key) {
    res.status(401).send("Not Authorized!");
  }

  const { bookingIds } = req.body;

  console.log("delete", bookingIds);

  Promise.all(bookingIds.map(bookingId => deleteTempBooking(bookingId))).then(
    () => {
      res.status(200).send("deleted bookings");
    },
    err => {
      console.log(err);
    }
  );
});

const confirmTempBooking = bookingId => {
  const docRef = db.collection("bookings").doc(bookingId);

  return docRef.update({
    isConfirmed: true
  });
};

export const confirmTempBookings = functions.https.onRequest((req, res) => {
  if (req.headers.key !== key) {
    res.status(401).send("Not Authorized!");
  }

  const { bookingIds } = req.body;

  console.log("confirm", bookingIds);

  Promise.all(bookingIds.map(bookingId => confirmTempBooking(bookingId))).then(
    () => {
      res.status(200).send("confirmed booking");
    },
    err => {
      console.log(err);
      res.status(401).send(err);
    }
  );
});
