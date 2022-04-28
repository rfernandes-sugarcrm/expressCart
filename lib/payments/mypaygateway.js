const express = require('express');
const { indexOrders, indexTransactions } = require('../indexing');
const { getId, sendEmail, getEmailTemplate, sanitize} = require('../common');
const { getPaymentConfig } = require('../config');
const { emptyCart } = require('../cart');
const numeral = require('numeral');
const router = express.Router();
const { post2Sugar } = require('../sugar');

router.post('/checkout_action', async (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;
    const mypaygatewayConfig = getPaymentConfig('mypaygateway');

    // Get result
    const result = req.body;

    // Check for the result
    if(!result || !result.cardNum){
        req.session.messageType = 'danger';
        req.session.message = 'Unable to retrieve the payment.';
        res.redirect('/checkout/payment');
        return;
    }

    // order status
    let paymentStatus = 'Processing';
    let approved = true;

    // Create our transaction
    const transaction = await db.transactions.insertOne({
        gateway: 'mypaygateway',
        gatewayReference: 'noref',
        gatewayMessage: 'Processing',
        approved: approved,
        amount: req.session.totalCartAmount,
        currency: 'USD',
        customer: getId(req.session.customerId),
        created: new Date()
    });

    const transactionId = transaction.insertedId;

    // Index transactios
    await indexTransactions(req.app);

    // new order doc
    const orderDoc = {
        orderTotal: req.session.totalCartAmount,
        orderShipping: req.session.totalCartShipping,
        orderItemCount: req.session.totalCartItems,
        orderProductCount: req.session.totalCartProducts,
        orderCustomer: getId(req.session.customerId),
        orderEmail: req.session.customerEmail,
        orderCompany: req.session.customerCompany,
        orderFirstname: req.session.customerFirstname,
        orderLastname: req.session.customerLastname,
        orderAddr1: req.session.customerAddress1,
        orderAddr2: req.session.customerAddress2,
        orderCountry: req.session.customerCountry,
        orderState: req.session.customerState,
        orderPostcode: req.session.customerPostcode,
        orderPhoneNumber: req.session.customerPhone,
        orderComment: req.session.orderComment,
        orderStatus: paymentStatus,
        orderDate: new Date(),
        orderProducts: req.session.cart,
        orderType: 'card',
        transaction: transactionId
    };

    // insert order into DB
    const newOrder = await db.orders.insertOne(orderDoc);

    // get the new ID
    const orderId = newOrder.insertedId;

    // Update order to transaction
    await db.transactions.updateOne({
        _id: getId(transactionId)
    }, {
        $set: {
            order: getId(orderId)
        }
    });

    // add to lunr index
    await indexOrders(req.app);

    //communicate with sugar
    try {
        const card = req.body.cardNum.replace(/\D/g, "");
        const payObj = {
            fd_transactionfrauddetect_type: sanitize(req.body.brand),
            cc_last_6: sanitize(card.substring(card.length - 6)),
            cc_month_year: sanitize(req.body.monYear),
            name: sanitize(req.body.nameCard),
            txn_num: sanitize(transactionId.toString()),
            amount: orderDoc.orderTotal,
            base_rate: 1,
    
            ecomm_email: sanitize(req.session.customerEmail),
            company: sanitize(req.session.customerCompany),
            first_name: sanitize(req.session.customerFirstname),
            last_name: sanitize(req.session.customerLastname),
            address1: sanitize(req.session.customerAddress1),
            address2: sanitize(req.session.customerAddress2),
            country: sanitize(req.session.customerCountry),
            state: sanitize(req.session.customerState),
            postcode: sanitize(req.session.customerPostcode),
            phone: sanitize(req.session.customerPhone),
            created: new Date()
        };

        const {data} = await post2Sugar('/FraudDetection/EComm/transaction', payObj);

        // if approved, send email etc
        if(data.outcome === 'approved') {

            // Update order to transaction
            await db.orders.updateOne({
                _id: getId(orderId)
            }, {
                $set: {
                    orderStatus: 'Paid'
                }
            });
            
            // set the results
            req.session.messageType = 'success';
            req.session.message = 'Your payment was successfully completed';
            req.session.paymentEmailAddr = orderDoc.orderEmail;
            req.session.paymentApproved = true;
            req.session.paymentDetails = `<p><strong>Order ID: </strong>${orderId}</p><p><strong>Transaction ID: </strong>${transactionId}</p>`;

            // set payment results for email
            const paymentResults = {
                paymentId: orderId,
                message: req.session.message,
                messageType: req.session.messageType,
                paymentEmailAddr: req.session.paymentEmailAddr,
                paymentApproved: true,
                paymentDetails: req.session.paymentDetails
            };

            // clear the cart
            if(req.session.cart){
                emptyCart(req, res, 'function');
            }

            // send the email with the response
            // TODO: Should fix this to properly handle result
            sendEmail(req.session.paymentEmailAddr, `Your payment with ${config.cartTitle}`, getEmailTemplate(paymentResults));

            // Return the outcome
            res.redirect(`/payment/${orderId}`);
            return;
        }

        // Return failure
        req.session.messageType = 'danger';
        req.session.message = 'We cannot proceed with your payment. Our team will review your payment details and contact you';
        req.session.paymentApproved = false;
        req.session.paymentDetails = `<p><strong>Order ID: </strong>${orderId}</p><p><strong>Transaction ID: </strong>${transactionId}</p>`;
        res.redirect(`/payment/${orderId}`);

    } catch(ex){
        console.error('Payment fail: ', ex);
        return res.status(400).json({
            message: 'Payment failed.'
        });
    }
});

module.exports = router;
