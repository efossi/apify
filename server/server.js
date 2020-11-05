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

const MAUTIC_BASE_URL = process.env.MAUTIC_URL || 'https://m2.beebl.io';
const MAUTIC_FORM_ID = process.env.MAUTIC_FORM_ID || '3';


app.get('/', (req, res) => {
  res.send('Hello from Node!');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});


// app.use(bodyParser.urlencoded({ extended: true }));
//app.use(bodyParser.json());

app.use(upload.array()); 
app.use(express.static('public'));

app.post('/apify', (req, res) => {

  if ( req && req.body && req.body.htmlParameter){
    const contactDetails = Apify.utils.social.parseHandlesFromHtml(req.body.htmlParameter);

    if ( contactDetails ){
      const contactList = contactDetails2List(contactDetails, req.body.url);
      console.log('Url: %s, ContactDetails: %s, ContactList: %s ', req.body.url, JSON.stringify(contactDetails), JSON.stringify(contactList) );
      saveContactDetailsToDB(contactList, req.body.url);
      postContactToForm(contactList,MAUTIC_FORM_ID);
    }
  	res.send(contactDetails);
  }else{
  	res.send({});	
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

const contactDetails2List = (contactDetails, url) =>{
  const contactList = [];
  Object.keys(contactDetails).forEach(function(key) {
    const values = contactDetails[key];

    if ( key === 'emails' && values && values.length ){
      values.forEach(v=>{
      //for(const v in values){
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

const postContactToForm = ( contactList, formId )=>{
  contactList.forEach( contact => {
    const form = new FormData();
    form.append('mauticform[formId]',formId);
    form.append('mauticform[messenger]','1');

    if( contact.email ){
      form.append('mauticform[email]',contact.email);
    }

    if( contact.firstname_unsure ){
      form.append('mauticform[first_name]',capitalize(contact.firstname_unsure));
    }
    if( contact.company_unsure ){
      form.append('mauticform[company]',contact.company_unsure);
    }    
    if( contact.lastname_unsure ){
      form.append('mauticform[last_name]',capitalize(contact.lastname_unsure));
    }
    if( contact.phone ){
      form.append('mauticform[phone]',contact.phone);
    }
    if( contact.linkedin ){
      form.append('mauticform[linkedin]',contact.linkedin);
    }
    if( contact.twitter ){
      form.append('mauticform[twitter]',contact.twitter);
    }
    if( contact.instagram ){
      form.append('mauticform[instagram]',contact.instagram);
    }
    if( contact.facebook ){
      form.append('mauticform[facebook]',contact.facebook);
    }
    if( contact.googleplus ){
      form.append('mauticform[googleplus]',contact.googleplus);
    }
    
    //Only post contacts with email
    if ( contact.email ){
      try{

        form.submit( MAUTIC_BASE_URL + '/form/submit', function(err, res) {
          if (err) {
            console.error("ERROR posting form: "+JSON.stringify(err));
          };
          console.log('Form posted: statusCode:',res.statusCode,' res.data:', res.data);
        } );       

      }catch(e){
        console.log('Error posting form:',e);
      }
    }

  })
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
      console.log("Query result:", table, JSON.stringify(data));
    }
  });
}

const insertiontQuery = (table, columns, values)=>{

  const query = "insert into "+table+" (" + columns.join(',') + 
  ") values (" + values.map(v => `'${v}'`).join(',') + ")" ;
  console.log("insertiontQuery into table: query:", query);
  return query;
}


