"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const moment = require("moment");
const admin = require("firebase-admin");
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();
const key = functions.config().horizontal.secret;
const checkIfAdmin = token => new Promise((resolve, reject) => {
    if (token) {
        admin
            .auth()
            .verifyIdToken(token)
            .then(function (decodedToken) {
            const isAdmin = decodedToken.admin;
            if (isAdmin) {
                resolve();
            }
            else {
                reject();
            }
        })
            .catch(function (error) {
            console.log("couldnt decode");
            reject();
        });
    }
    else {
        reject();
    }
});
const checkIfSlotIsAvailable = ({ startTime, endTime, bookingDate, bookingId }) => new Promise((resolve, reject) => {
    const newBookingStartTime = moment(startTime, "HH:mm");
    const newBookingEndTime = moment(endTime, "HH:mm");
    db.collection("bookings")
        .where("bookingDate", "==", bookingDate)
        .get()
        .then(function (querySnapshot) {
        querySnapshot.forEach(function (doc) {
            console.log(doc.id, " => ", doc.data());
            const exitingBooking = doc.data();
            const existingBookingStartTime = moment(exitingBooking.startTime, "HH:mm");
            const existingBookingEndTime = moment(exitingBooking.endTime, "HH:mm");
            console.log("compare", startTime, endTime, exitingBooking.startTime, exitingBooking.endTime);
            if (doc.id !== bookingId &&
                !(existingBookingEndTime.isSameOrBefore(newBookingStartTime) ||
                    existingBookingStartTime.isSameOrAfter(newBookingEndTime))) {
                reject("slot is taken");
            }
        });
        resolve();
    })
        .catch(function (error) {
        console.log("Error getting documents: ", error);
    });
});
const addBooking = (bookingBody, res) => {
    console.log(bookingBody);
    const { name, email, phoneNumber = "not provided", bookingDate, startTime, endTime, message = "", price = "0", currency = "GBP", method = "unknown", isConfirmed } = bookingBody;
    checkIfSlotIsAvailable({
        startTime,
        endTime,
        bookingDate,
        bookingId: undefined
    }).then(() => {
        const bookingCreationTime = Date.now();
        const adjustName = name.replace(/\s+/g, "-").toLowerCase();
        const bookingId = `${bookingCreationTime}-${adjustName}`;
        const docRef = db.collection("bookings").doc(bookingId);
        docRef
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
            .then(ref => {
            console.log("Added document with ID: ", bookingId, ref);
            res.status(200).send({ bookingId, bookingCreationTime });
            !isConfirmed &&
                setTimeout(() => {
                    docRef.get().then(doc => {
                        if (doc.exists) {
                            console.log("Document data:", doc.data());
                            const data = doc.data();
                            if (!data.isConfirmed) {
                                docRef.delete();
                            }
                        }
                        else {
                            console.log("No such document!");
                        }
                    });
                }, 600000);
        });
    }, err => {
        console.log(err);
        res.status(401).send(err);
    });
};
const editBooking = (bookingBody, res) => {
    console.log(bookingBody);
    const { bookingId } = bookingBody, bookingObject = __rest(bookingBody, ["bookingId"]);
    const { startTime, endTime, bookingDate } = bookingObject;
    checkIfSlotIsAvailable({ startTime, endTime, bookingDate, bookingId }).then(() => {
        const docRef = db.collection("bookings").doc(bookingId);
        docRef.update(bookingObject).then(ref => {
            console.log("Updated document with ID: ", bookingId, ref);
            res.status(200).send(bookingId);
        });
    }, err => {
        console.log(err);
        res.status(401).send(err);
    });
};
exports.createAdminBooking = functions.https.onRequest((req, res) => {
    if (req.method !== "POST") {
        res.status(403).send("Forbidden!");
    }
    const _a = req.body, { token } = _a, bookingObject = __rest(_a, ["token"]);
    checkIfAdmin(token).then(() => {
        console.log("allowed");
        addBooking(bookingObject, res);
    }, () => {
        res.status(403).send("You are not an admin");
    });
});
exports.editAdminBooking = functions.https.onRequest((req, res) => {
    if (req.method !== "POST") {
        res.status(403).send("Forbidden!");
    }
    const _a = req.body, { token } = _a, bookingObject = __rest(_a, ["token"]);
    checkIfAdmin(token).then(() => {
        console.log("allowed");
        editBooking(bookingObject, res);
    }, () => {
        res.status(403).send("You are not an admin");
    });
});
exports.createNewBooking = functions.https.onRequest((req, res) => {
    console.log("create mew", req.body);
    if (req.headers.key !== key) {
        res.status(401).send("Not Authorized!");
    }
    if (req.method !== "POST") {
        res.status(403).send("Forbidden!");
    }
    const bookingObject = req.body;
    addBooking(bookingObject, res);
});
exports.deleteTempBooking = functions.https.onRequest((req, res) => {
    if (req.headers.key !== key) {
        res.status(401).send("Not Authorized!");
    }
    const { bookingId } = req.body;
    console.log("delete", bookingId);
    const docRef = db.collection("bookings").doc(bookingId);
    docRef.delete().then(ref => {
        console.log("Removed document");
        res.status(200).send("temporary booking removed");
    });
});
exports.confirmTempBooking = functions.https.onRequest((req, res) => {
    if (req.headers.key !== key) {
        res.status(401).send("Not Authorized!");
    }
    const { bookingId } = req.body;
    console.log("confirm", bookingId);
    const docRef = db.collection("bookings").doc(bookingId);
    docRef
        .update({
        isConfirmed: true
    })
        .then(ref => {
        console.log("Confirmed document");
        res.status(200).send("confirmed booking");
    });
});
//# sourceMappingURL=index.js.map