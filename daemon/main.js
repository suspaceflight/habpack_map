var fs = require("fs");
var http = require('http');
var io = require('socket.io')(3000);
var msgpack = require('msgpack');

//var payload_id = "8d79cfdd19c844b7793d5bab624b7e10";
var payload_name = "SFSU";
var payload_id = "af8ad89b61635db9615f5e2674e0a318";
// CHANGE THIS FOR FLIGHT DAY
var habitat_interval = 1; // seconds
var days_history = 4;


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
    if(typeof(hb_string)=="undefined")
    {
        return;
    }
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
    var temp_time = seconds_utc;
    var temp_lat = start_pos[0];
    var temp_lon = start_pos[1];
    var temp_alt = start_pos[2];
    for(var i=0;i<diffs_length;i++)
    {
        temp_time+=(i/5);
        temp_lat+=(diff_lats[i]*latlon_scaling);
        temp_lon+=(diff_lons[i]*latlon_scaling);
        temp_alt+=((diff_alts[i]*alt_scaling)/1000);
        output.data.push(
            [
                habitat_key,
                packet_counter,
                temp_time.toFixed(0),
                temp_lat,
                temp_lon,
                temp_alt,
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
        socket.emit('full_history', {date: startup_date, history: payload_data});
    });

    socket.on('history_since', function (data) {
        // Get all data since data.id or data.last_date or /similar/
        function filterKey(item, index, array) {
            return (item[0] > data.latest_key);
        }
        console.log('Request for partial history.');
        socket.emit('partial_history', {date: startup_date, history: payload_data.filter(filterKey)});
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
                if(typeof(data)=="undefined") return;
                data.rows.forEach(function(telem_doc)
                {
                    //console.log(telem_doc.doc.data.habpack);
                    //console.log(msgpack.decode(base64ToArrayBuffer(telem_doc.doc.data.habpack)));
                    //console.log(habpack_decode(telem_doc.doc.data.habpack));
                    var hb_data = habpack_decode(telem_doc.key[1],telem_doc.doc.data.habpack);
                    if(typeof(hb_data)=="undefined") return;
                    hb_data.data.forEach(function(string_data)
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

/* Habitat polling, broadcasts any new data */
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
                    io.emit("partial_history",{date: startup_date, history: new_data});
                    generate_kml();
            }
            habitat_http_busy = 0;
        });
    }
},habitat_interval*1000);

var kml_data = "";
var kml_header = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://earth.google.com/kml/2.0">
<Document>
  <name>Track</name>
  <Style id="balloon">
    <IconStyle>
      <scale>2</scale>
      <Icon>
      <href>https://susf.philcrump.co.uk/static/images/balloon-red.png</href>
      </Icon>
     <hotSpot x="0.5"  y="0" xunits="fraction" yunits="fraction"/>
     </IconStyle>
  </Style>
`;

/* KML Generation */
function generate_kml()
{
    var payload_data_len = payload_data.length;
    if(payload_data_len!=0)
    {
        console.log("Generating KML..");

        var last_position = payload_data[payload_data_len-1];
        var last_date = new Date(last_position[0]*1000);

        kml_data = kml_header;
        kml_data+="<Folder>\n";
        kml_data+="<name>"+payload_name+"</name>\n";
        kml_data+="<Placemark>\n";
        kml_data+="<description><![CDATA[<b>Vehicle:</b> "+payload_name+"<br /><b>Time:</b> "+last_date.toLocaleDateString()+" "+last_date.toLocaleTimeString()+"<br /><b>Position:</b>"+(last_position[3]/10000000)+","+(last_position[4]/10000000)+"<br /><b>Altitude:</b> "+last_position[5]+" m<br /></br>]]></description>\n";
        kml_data+="<name>"+payload_name+"</name>\n";
        kml_data+="<LookAt>\n";
        kml_data+=" <longitude>"+(last_position[4]/10000000)+"</longitude>\n";
        kml_data+=" <latitude>"+(last_position[3]/10000000)+"</latitude>\n";
        kml_data+=" <altitude>"+last_position[5]+"</altitude>\n";
        kml_data+=" <altitudeMode>absolute</altitudeMode>\n";
        kml_data+=" <range>20000</range>\n";
        kml_data+=" <tilt>25</tilt>\n";
        kml_data+=" <heading>0</heading>\n";
        kml_data+="</LookAt>\n";
        kml_data+="<visibility>1</visibility>\n";
        kml_data+="<styleUrl>#balloon</styleUrl>\n";
        kml_data+="<Point>\n";
        kml_data+=" <extrude>0</extrude>\n";
        kml_data+="  <altitudeMode>absolute</altitudeMode>\n";
        kml_data+="  <coordinates>"+(last_position[4]/10000000)+","+(last_position[3]/10000000)+","+last_position[5]+"</coordinates>\n";
        kml_data+="</Point>\n";
        kml_data+="</Placemark>\n";
        var i = 0;
        var segment_id = 1;
        while(i<payload_data_len)
        {
            kml_data+="<Placemark>\n";
            kml_data+="<name>Track Segment #"+segment_id+"</name>\n";
            kml_data+="<visibility>1</visibility>\n";
            kml_data+="<Style>\n";
            kml_data+=" <LineStyle>\n";
            kml_data+="  <color>ff0000ff</color>\n";
            kml_data+="  <width>4</width>\n";
            kml_data+=" </LineStyle>\n";
            kml_data+=" <PolyStyle>\n";
            kml_data+="  <color>7fffffff</color>\n";
            kml_data+=" </PolyStyle>\n";
            kml_data+="</Style>\n";
            kml_data+="<LineString>\n";
            //kml_data+=" <extrude>1</extrude>\n";
            kml_data+=" <tessellate>1</tessellate>\n";
            kml_data+=" <altitudeMode>absolute</altitudeMode>\n";
            kml_data+=" <coordinates>\n";
            var j=0;
            while(j<15000 && i<payload_data_len)
            {
                kml_data+=(payload_data[i][4]/10000000)+","+(payload_data[i][3]/10000000)+","+payload_data[i][5]+"\n";
                i++;
                j++;
            }
            kml_data+="</coordinates>\n";
            kml_data+="</LineString>\n";
            kml_data+="</Placemark>\n";
            segment_id++;
        }
        kml_data+=` </Folder>
        </Document>
         </kml>
        `;

        fs.writeFile("/srv/susf/payload.kml", kml_data, function(err)
        {
            if(err) {
                return console.log(err);
            }
            console.log("KML Saved.");
        }); 
    }
}

startup_date = Date.now();
var payload_callsign = "";
console.log("HABpack map daemon - standing by.");
