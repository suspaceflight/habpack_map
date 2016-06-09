var http = require('http');
var io = require('socket.io')(3000);
var msgpack = require('msgpack');

//var payload_id = "8d79cfdd19c844b7793d5bab624b7e10";
var payload_id = "af8ad89b61635db9615f5e2674e0a318";
// CHANGE THIS FOR FLIGHT DAY
var habitat_interval = 1; // seconds
var days_history = 5;
//var habitat_test_options = {
//  host: 'habitat.habhub.org',
//  path: '/habitat/_design/payload_telemetry/_view/payload_time?startkey=[%228d79cfdd19c844b7793d5bab624b7e10%22,[]]&endkey=[%228d79cfdd19c844b7793d5bab624b7e10%22]&include_docs=True&descending=True'
//};

//var test_1 = "igCnUEFZSU9BRAFWAs4AATMuA5POHlzQFNL/LNjzDQQLKAUyADwBPQE+k5YEBQUDDACWAwYEBBMAlgAAAAAAAA==";
//var test_2 = "igCnUEFZSU9BRAECAkIDk84eXNTH0v8s32gaBBAoBTIAPAA9Aj6Tlf4C/v38lQUECgkPlQH28+bn";

Array.prototype.extend = function (other_array) {
    other_array.forEach(function(v) {this.push(v)}, this);    
}

if (!Array.prototype.filter)
{
  Array.prototype.filter = function(fun /*, thisp*/)
  {
    var len = this.length;
    if (typeof fun != "function")
      throw new TypeError();
    var res = new Array();
    var thisp = arguments[1];
    for (var i = 0; i < len; i++)
    {
      if (i in this)
      {
        var val = this[i]; // in case fun mutates this
        if (fun.call(thisp, val, i, this))
          res.push(val);
      }
    }
    return res;
  };
}

function habpack_decode(habitat_key,habpack_base64) {
    var hb_string = msgpack.unpack(Buffer.from(habpack_base64, 'base64'));
    var start_pos = hb_string[3];
    var latlon_scaling = Math.pow(2,hb_string[60]);
    var alt_scaling = Math.pow(2,hb_string[61]);
    var diffs_length = hb_string[62][0].length;
    var diff_lats = hb_string[62][0];
    var diff_lons = hb_string[62][1];
    var diff_alts = hb_string[62][2];
    
    var callsign = hb_string[0];
    var packet_counter = hb_string[1];
    var seconds_utc = hb_string[2];
    var satellites_num = hb_string[4];
    var battery_mv = hb_string[40];
    var uplink_num = hb_string[50];
    
    payload_callsign = callsign;
    var output = {callsign: callsign, data: []};
    output.data.push(
            [
                habitat_key,
                packet_counter,
                seconds_utc,
                start_pos[0],
                start_pos[1],
                start_pos[2],
                satellites_num,
                battery_mv,
                //uplink_num
            ]
        );
    for(var i=0;i<diffs_length;i++)
    {
        output.data.push(
            [
                habitat_key,
                packet_counter,
                seconds_utc,
                start_pos[0]+(diff_lats[i]*latlon_scaling),
                start_pos[1]+(diff_lons[i]*latlon_scaling),
                start_pos[2]+((diff_alts[i]*alt_scaling)/1000),
                satellites_num,
                battery_mv,
                //uplink_num
            ]
        );
    }
    //console.log(output.data);
    return output;
}

//console.log("Test 1:");
//console.log(msgpack.unpack(Buffer.from(test_1, 'base64')));

//console.log("Test 2:");
//console.log(msgpack.unpack(Buffer.from(test_2, 'base64')));


io.on('connection', function (socket) {
    //console.log("Got websocket");
    socket.on('history_full', function()
    {
        console.log('Request for all history.');
        socket.emit('full_history', {callsign: payload_callsign, date: startup_date, history: payload_data});
    });

    socket.on('history_since', function (data) {
        // Get all data since data.id or data.last_date or /similar/
        function filterKey(item, index, array) {
            return (item[0] > data.latest_key);
        }
        console.log('Request for partial history.');
        socket.emit('partial_history', {callsign: payload_callsign, date: startup_date, history: payload_data.filter(filterKey)});
    });
});

function habitat_http_sync(cb) {
        habitat_http_callback = function(response)
        {
            var str = '';
            response.on('data', function (chunk) {
                str += chunk;
            });
            response.on('end', function () {
                var data = JSON.parse(str);
                data.rows.forEach(function(telem_doc)
                {
                    //console.log(telem_doc.doc.data.habpack);
                    //console.log(msgpack.decode(base64ToArrayBuffer(telem_doc.doc.data.habpack)));
                    //console.log(habpack_decode(telem_doc.doc.data.habpack));
                    habpack_decode(telem_doc.key[1],telem_doc.doc.data.habpack).data.forEach(function(string_data)
                    {
                        payload_data.push(string_data);
                    });
                    if(telem_doc.key[1]>latest_key)
                    {
                        latest_key = telem_doc.key[1];
                    }
                    //console.log(habpack_decode(telem_doc.doc.data.habpack));
                });
                cb();
            });
        };
        http.request(habitat_http_options, habitat_http_callback).end();
}

var latest_key = 0;
var habitat_http_options;
var habitat_http_busy = 0;
var payload_data = [];

var latest_key = (Math.floor(Date.now() / 1000)) - ((24*3600)*days_history);

setInterval(function()
{
    if(!habitat_http_busy)
    {
        habitat_http_busy = 1;
        //console.log("Latest key: "+latest_key);
        //console.log("Payload Data length: "+payload_data.length);
        habitat_http_options = { 
            host: 'habitat.habhub.org',
            path: '/habitat/_design/payload_telemetry/_view/payload_time?startkey=[%22'+payload_id+'%22,'+(latest_key+1)+']&endkey=[%22'+payload_id+'%22,[]]&include_docs=True'
        };
        //console.log("Requesting from habitat..");
        var old_latest_key = latest_key;
        habitat_http_sync(function()
        {
            //console.log("Request Complete");
            if(latest_key > old_latest_key) {
                // New data!
                    function filterKey(item, index, array) {
                        return (item[0] > old_latest_key);
                    }
                    //console.log(payload_data);
                    var new_data = payload_data.filter(filterKey);
                    console.log("Got "+new_data.length+" rows of new payload data!");
                    io.emit("partial_history",{history: new_data});
            }
            habitat_http_busy = 0;
        });
    }
},habitat_interval*1000);

startup_date = Date.now();
var payload_callsign = "";
console.log("HABpack map daemon - standing by.");
