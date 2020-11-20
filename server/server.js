const express = require('express');
const bodyParser = require('body-parser');
const Apify = require('apify');
const multer = require('multer');
const mysqlDb = require('./db/mysqlDb');
const FormData = require('form-data');
const URL = require('url');
require('log-timestamp');
const upload = multer();
const app = express();
const AWS = require("aws-sdk");

const MAUTIC_BASE_URL = process.env.MAUTIC_URL || 'https://m2.beebl.io';
const MAUTIC_FORM_ID = process.env.MAUTIC_FORM_ID || '3';
const NB_ATTEMPTS = 5;
const MILLIS_BETWEEN_ATTEMPS = 2*60*1000 ; //millis

app.get('/', (req, res) => {
  res.send('Hello from Node!');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});



app.use(function(req, res, next) {
  if (req.get("x-amz-sns-message-type")) {
//otherwise content-type is text for topic confirmation reponse, and body is empty    
    req.headers["content-type"] = "application/json"; 
  }
  next();
});

app.use('/apify', [ upload.array(), express.static('public') ] ); 
app.use('/ses', bodyParser.json());


app.post('/apify', (req, res) => {

  if ( req && req.body && req.body.htmlParameter){
    const contactDetails = Apify.utils.social.parseHandlesFromHtml(req.body.htmlParameter);
    let contactList = []
    if ( contactDetails ){
      contactList = contactDetails2List(contactDetails, req.body.url);
      console.log('Url: %s, ContactDetails: %s, ContactList: %s ', req.body.url, JSON.stringify(contactDetails), JSON.stringify(contactList) );
      saveContactDetailsToDB(contactList, req.body.url);
      // postContactToForm(contactList,MAUTIC_FORM_ID);
    }
  	res.status(200).send({contactList:contactList, details:contactDetails});
  }else{
  	res.status(404).json({
      success: false,
      message: 'missing htmlParameter'
    });	
  }
});




const extractNameFromEmail = (email, separatingChar)=>{
  const nameSection = email.substring( 0, email.indexOf('@') ); 

  let firstName='';
  let lastName='';
  let middleName='';

  if ( nameSection.indexOf(separatingChar) > 0 &&  
      nameSection.indexOf(separatingChar) == nameSection.lastIndexOf(separatingChar) ){


    firstName =  nameSection.substring(0,nameSection.indexOf(separatingChar));
    lastName = nameSection.substring(nameSection.indexOf(separatingChar)+1);

  }else if (nameSection.indexOf(separatingChar) > 0 && 
    nameSection.indexOf(separatingChar) < nameSection.lastIndexOf(separatingChar)){

    firstName =  nameSection.substring(0,nameSection.indexOf(separatingChar));
    lastName = nameSection.substring(nameSection.lastIndexOf(separatingChar)+1);
    middleName = nameSection.substring(nameSection.indexOf(separatingChar)+1,nameSection.lastIndexOf(separatingChar));
  }
  return {fn:firstName, ln:lastName, mn:middleName};
}
const capitalize = (s) => {
  if (typeof s !== 'string') return ''
  return s.charAt(0).toUpperCase() + s.toLowerCase().slice(1);
}

const extractNameFromEmailCamelCase = (email)=>{
  const nameSection = email.substring( 0, email.indexOf('@') ); 

  let firstName='';
  let lastName='';
  let middleName='';

  const re = /[A-Z]/g;

  const matches = [...email.matchAll(re)];

  if ( matches && matches.length && matches.length > 1 ) {
    if (matches.length == 2){

      firstName = nameSection.substring(matches[0].index,matches[1].index);
      lastName = nameSection.substring(matches[1].index);
    } else if (matches.length == 3){

      firstName = nameSection.substring(matches[0].index,matches[1].index);
      middleName = nameSection.substring(matches[1].index,matches[2].index);;
      lastName = nameSection.substring(matches[2].index);
    }
  }
  return {fn:firstName, ln:lastName, mn:middleName};
}

const acceptableEmail = async (email) => {

 // To remove emails like
 // rizwest1975@yahoo.comm    
 // Hotro.ttvnol@gmail.comli    
  const reToExclude = ['@.*\.com[a-zA-Z0-9]+'];


  const acceptableDomains = ['comcastbiz.net', 
                           '.company', 
                           'comperia.pl', 
                           'commnet.edu'];

  const prohibitedDomains = [
                           //  '@mail.ru', 
                           // '@inbox.ru', 
                           // '@gpsmcard.ru',
                           // '@shakespeare-online.com'
                           ];
                           
  // Exclude email from prohibitedDomains, then
  // Exclude emails that match any re in reToExclude 
  // unless the email ends in a domain in acceptableDomains
  const prohibitedD = prohibitedDomains.filter( d => email.toLowerCase().endsWith(d.toLowerCase()) );
  if ( prohibitedD && prohibitedD.length > 0){
    return false;
  }

// Make sure the email is not on the do-not-contact list
  
  const doNotContact = await promiseOfQuery('select l.email from leads l join lead_donotcontact dnc on l.id = dnc.lead_id where l.email = ?', email);
  console.log('doNotContact result:',doNotContact);
  if ( doNotContact && doNotContact.length > 0 ){
    console.log('Found email in do-not-contact', email);
    return false;
  }
  // const prohibitedN = prohibitedEmailMatches.filter( d => email.toLowerCase().indexOf(d) > -1 );
  // if ( prohibitedN && prohibitedN.length > 0){
  //   return false;
  // }

  const domains = acceptableDomains.filter( a => email.endsWith(a) );
  if (domains && domains.length > 0){
    return true;
  }else{
    const res = reToExclude.filter( ( re ) => email.match(new RegExp(re) ));
    if ( res && res.length > 0){
      return false;
    }else{
      return true;
    }
  }
}



const contactDetails2List = (contactDetails, url) =>{
  const contactList = [];


  Object.keys(contactDetails).forEach(function(key) {
    const values = contactDetails[key];

    if ( key === 'emails' && values && values.length ){
      values.forEach(v=>{
        // Filter out invalid email
        if(v && acceptableEmail(v) ){
          let emailDetails = extractNameFromEmail(v, '.');

          if( !emailDetails.fn && !emailDetails.ln) {
            emailDetails = extractNameFromEmail(v, '_');
          }

          if( !emailDetails.fn && !emailDetails.ln) {
            emailDetails = extractNameFromEmailCamelCase(v);
          }
          contactList.push({
            email: v,
            firstname_unsure: emailDetails.fn,
            lastname_unsure: emailDetails.ln,
            middlename_unsure: emailDetails.mn,
            company_unsure: (url && url.length>0) ? URL.parse(url).hostname : ''
          });
        }else {
          console.log("Unacceptable email: ", v);
        }
      });
    }

    if ( key === 'phones' && values && values.length ){

      values.forEach(v=>{ 
        contactList.push({phone:v});
      })
    }
    if ( key === 'linkedIns' && values && values.length ){

      values.forEach(v=>{
        contactList.push({linkedin:v});
      })
    }
    if ( key === 'twitters' && values && values.length ){

      values.forEach(v=>{
        contactList.push({twitter:v});
      })
    }
    if ( key === 'instagrams' && values && values.length ){

      values.forEach(v=>{
        contactList.push({instagram:v});
      })
    }
    if ( key === 'facebooks' && values && values.length ){

      values.forEach(v=>{
        contactList.push({facebook:v});
      })
    }
    if ( key === 'youtubes' && values && values.length ){

      values.forEach(v=>{ 
        contactList.push({googleplus:v});
      })
    }
  });
  return contactList;
}

const saveContactDetailsToDB = (contactList, url)=>{
  const queries = [];

  contactList.forEach(contact=>{
    const columns = ['url'];
    const values = [url];

    if( contact.email ){
      columns.push('email');
      values.push(capitalize(contact.email));
    }
    if( contact.firstname_unsure ){
      columns.push('firstname_unsure');
      values.push(capitalize(contact.firstname_unsure));
    }
    if( contact.lastname_unsure ){
      columns.push('lastname_unsure');
      values.push(capitalize(contact.lastname_unsure));
    }
    if( contact.middlename_unsure ){
      columns.push('middlename_unsure');
      values.push(capitalize(contact.middlename_unsure));
    }
    if( contact.company_unsure ){
      columns.push('company_unsure');
      values.push(contact.company_unsure);
    }    
    if( contact.phone ){
      columns.push('phone');
      values.push(contact.phone);
    }
    if( contact.linkedin ){
      columns.push('linkedin');
      values.push(contact.linkedin);
    }
    if( contact.twitter ){
      columns.push('twitter');
      values.push(contact.twitter);
    }
    if( contact.instagram ){
      columns.push('instagram');
      values.push(contact.instagram);
    }
    if( contact.facebook ){
      columns.push('facebook');
      values.push(contact.facebook);
    }
    if( contact.googleplus ){
      columns.push('googleplus');
      values.push(contact.googleplus);
    }
    //queries.push(insertiontQuery('external_leads', columns, values))
    insertIntoDB('external_leads', columns, values);
  });

}


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const setDoNotContact = async ( contact )=>{    
  //Only contacts with email
  if ( contact.email ){
    try{

      const idQueryRes = await promiseOfQuery ( `select id from leads where email='${contact.email}'`, null );

      console.log('idQueryRes: ', idQueryRes);
      if( idQueryRes && idQueryRes.length > 0){
        const leadId = idQueryRes[0].id
        console.log('leadId: ', leadId);
        const insertQuery = `insert into lead_donotcontact(lead_id , date_added , reason , channel , channel_id , comments) values('${leadId}',now(),'1','email',39,'User unsubscribed by external API');`;
        const queryRes = await promiseOfQuery ( insertQuery, null );
        return queryRes;    
      }
    }catch(e){
      console.log('Error posting form:',e);
    }
  }
}

const postContactToForm = async ( contact, formId )=>{
    const form = new FormData();
    form.append('mauticform[formId]',formId);
    form.append('mauticform[messenger]','1');

    if( contact.email ){
      form.append('mauticform[email]',contact.email);
    }
       
    //Only  contacts with email
    if ( contact.email ){
      try{

        const formResponse =  await promiseOfFormData(form, MAUTIC_BASE_URL + '/form/submit' );
        return formResponse;    

      }catch(e){
        console.log('Error posting form:',e);
      }
    }

}

const insertIntoDB = (table, columns, values)=>{

  const query = "insert into "+table+" (" + columns.join(',') + 
  ") values (" + values.map(v => `'${v}'`).join(',') + ")" ;
  console.log("Inserting into table: query:", query);
  mysqlDb.query(query, null, function (data, error) {       
    if (error){
      console.log("Error while inserting into table: "+ JSON.stringify(error));
    }else{
      console.log("Insertion into table:", table, JSON.stringify(data));
    }
  });
}

const runQueryToDB = (query)=>{
  console.log("runQueryToDB - query:", query);
  mysqlDb.query(query, null, function (data, error) {       
    if (error){
      console.log("Error while running query: "+ JSON.stringify(error));
    }else{
      console.log("Query result:", JSON.stringify(data));
    }
  });
}

const insertiontQuery = (table, columns, values)=>{

  const query = "insert into "+table+" (" + columns.join(',') + 
  ") values (" + values.map(v => `'${v}'`).join(',') + ")" ;
  console.log("insertiontQuery into table: query:", query);
  return query;
}


const promiseOfFormData = ( form, url ) => {
  return new Promise(function (resolve, reject) {

    form.submit( url, function(err, res) {

      if (err || res.statusCode != 200 ) {
        console.error("ERROR posting form: ", err, res);
        if (err)
          reject(err);
        else
          resolve({ status: res.statusCode});
      };
      console.log('Form posted: statusCode:',res.statusCode,' res.data:', res.data);
      resolve(res);
    } );    
  });
}

const promiseOfQuery = ( query, params ) => {
  return new Promise(function (resolve, reject) {

    console.log("runQueryToDB - query, params:", query, params);
    mysqlDb.query(query, params, function (data, error) {       
      if (error){

        console.log("Error while running query: "+ JSON.stringify(error));
        reject(error);
      }else{
        resolve(data);
        console.log("Query result:", JSON.stringify(data));
      }
    });    
  });
}








AWS.config.update({
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
  region: "us-east-1"
});

const sns = new AWS.SNS();

const topicArnBounce = process.env.TOPIC_ARN_BOUNCE;
var paramsTopicBounces = {
  Protocol: "https",
  TopicArn: topicArnBounce,
  Endpoint: process.env.BOUNCE_ENDPOINT
};

const topicArnComplaint =process.env.TOPIC_ARN_COMPLAINT
var paramsTopicComplaints = {
  Protocol: "https",
  TopicArn: topicArnComplaint,
  Endpoint: process.env.COMPLAINT_ENDPOINT
};

sns.subscribe(paramsTopicBounces, function(error, data) {
  if (error) throw new Error(`Unable to set up SNS subscription: ${error}`);
  console.log(`SNS subscription set up successfully: ${JSON.stringify(data)}`);
});

sns.subscribe(paramsTopicComplaints, function(error, data) {
  if (error) throw new Error(`Unable to set up SNS subscription: ${error}`);
  console.log(`SNS subscription set up successfully: ${JSON.stringify(data)}`);
});

const handleSnsNotification = async (req, res) => {
  const message = JSON.parse(req.body.Message);
  // console.log('handleSnsNotification message :',message);

  if (
    (message && message.notificationType == "Bounce") ||
    message.notificationType == "Complaint"
  ) {
    const mail = message.mail;
    if (mail && mail.destination) {
      for (let i = 0; i < mail.destination.length; i++) {
        const address = mail.destination[i];
        try {
//  Make n attempts to update the contact. If all the attempts all fail, 
// send a email
          for ( let j = 0 ; j < NB_ATTEMPTS ; j++ ) {
            console.log(`Attempt ${j} to set DoNotContact for ${address}`);
            const res = await setDoNotContact( {email:address } );
            if (res){
              return res;
            }else {
              await sleep (MILLIS_BETWEEN_ATTEMPS);
            }
            // If we get here, send an email
            console.log(`Should send an email about failing to set DoNotContact for ${address}`);
          }
        } catch (error) {
          console.error( "Error setting DoNotContact for ",address);
          console.error(error.message);
        }
      }
    }
  }
};

const handleResponse = async (topicArn, req, res) => {
  
  if (
    req.headers["x-amz-sns-message-type"] === "Notification" &&
    req.body.Message
  ) {
    // console.log('handleResponse - notification topicArn, req.body',topicArn, req.body);
    await handleSnsNotification(req, res);
  } else if (
    req.headers["x-amz-sns-message-type"] === "SubscriptionConfirmation"
  ) {
    var params = {
      Token: req.body.Token,
      TopicArn: topicArn
    };
    sns.confirmSubscription(params, function(err, data) {
      if (err) throw err; // an error occurred
      console.error("handleResponse - data:", data);
    });
  }
};



app.post('/ses/do-not-contact', async (req, res) => {
    console.log('do-not-contact req.body:',req.body);

    if ( req && req.body && req.body.email ){
      const email = req.body.email;

      if ( email && email.includes("@") ) {
        try{
          const doNotContactRes = await setDoNotContact( {email:email } );
          if (doNotContactRes){
            res.status(200).json({
              success: true,
              message: doNotContactRes
            });
          }else {
            res.status(404).json({
              success: false,
              message: 'Issue setting do-not-contact'
            });
          }
        }catch(err){
          console.log('error in do-not-contact req.body:',err);
          res.status(500).json({
              success: false,
              message: err
          });
        }
      }
    }else{
      res.status(404).json({
        success: false,
        message: "Missing email parameter"
      });    
    }
});

app.post('/ses/handle-bounces-and-complaints', async (req, res) => {
  try {
    await handleResponse(topicArnBounce, req, res);
    console.log("Successfully handled bounce-complaint:");
    res.status(200).json({
      success: true,
      message: "Successfully received message"
    });
  } catch (error) {
    console.error("Error handling response:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
