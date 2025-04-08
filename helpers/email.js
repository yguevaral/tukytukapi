const { default: axios } = require("axios");

const sendEmailCodeVerification = async (to, name, code) => {


    let data = JSON.stringify({
        "from": {
            "email": "info@tukytuk.com"
        },
        "to": [
            {
            "email": to
            }
        ],
        "subject": `Hola ${name}, Bienvenido a Tukytuk!`,
        "personalization": [
            {
            "email": to,
            "data": {
                "code": code,
                "name": name
            }
            }
        ],
        "template_id": "0r83ql3m28zgzw1j"
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url:  process.env.EMAIL_SERVICE,
        headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${process.env.EMAIL_API_KEY}`
        },
        data : data
    };


    const response = await axios.request(config);

    if (response.status !== 202) {
        return false;
    }
    
    return true;
};

const sendEmailNotificationNewDriverDocs = async (driverName) => {


    let data = JSON.stringify({
        "from": {
            "email": "admin@tukytuk.com"
        },
        "to": [
            {
                "email": "admin@tukytuk.com"
            }
        ],
        "subject": `${driverName} envio sus documentos para ser conductor`,
        "personalization": [{
            "email": "admin@tukytuk.com",
            "data": {
                "DriverName": driverName
            }
        }],
        "template_id": "pr9084zjwemgw63d"
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url:  process.env.EMAIL_SERVICE,
        headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${process.env.EMAIL_API_KEY}`
        },
        data : data
    };


    const response = await axios.request(config);

    if (response.status !== 202) {
        return false;
    }
    
    return true;
};

const sendEmailNotificationUserDriverRequestUpdate = async (to, driverName, statusRequestDriverText) => {


    let data = JSON.stringify({
        "from": {
            "email": "info@tukytuk.com"
        },
        "to": [
            {
            "email": to
            }
        ],
        "subject": `${driverName}, Tiene un nuevo estado en su solicitud`,
        "personalization": [
            {
            "email": to,
            "data": {
                "statusRequestDriverText": statusRequestDriverText
            }
            }
        ],
        "template_id": "x2p0347v8xp4zdrn"
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url:  process.env.EMAIL_SERVICE,
        headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${process.env.EMAIL_API_KEY}`
        },
        data : data
    };


    const response = await axios.request(config);

    if (response.status !== 202) {
        return false;
    }
    
    return true;
};

module.exports = {
    sendEmailCodeVerification,
    sendEmailNotificationNewDriverDocs,
    sendEmailNotificationUserDriverRequestUpdate
};
