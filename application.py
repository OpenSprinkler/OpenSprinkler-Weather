#!/usr/bin/python
import urllib, urllib2, cgi, re
import json, datetime, time, sys, calendar
import pytz, ephem
from datetime import datetime, timedelta, date
def safe_float(s, dv):
    r = dv
    try:
        r = float(s)
    except:
        return dv
    return r

def safe_int(s, dv):
    r = dv
    try:
        r = int(s)
    except:
        return dv
    return r

def isInt(s):
    try:
        _v = int(s)
    except:
        return 0
    return 1

def isFloat(s):
    try:
        _f = float(s)
    except:
        return 0
    return 1

def IP2Int(ip):
    o = map(int, ip.split('.'))
    res = (16777216 * o[0]) + (65536 * o[1]) + (256 * o[2]) + o[3]
    return res

def getClientAddress(environ):
    try:
        return environ['HTTP_X_FORWARDED_FOR'].split(',')[-1].strip()
    except KeyError:
        return environ['REMOTE_ADDR']

def application(environ, start_response):
    path = environ.get('PATH_INFO')
    uwt = re.match('/weather(\d+)\.py',path)
    parameters = cgi.parse_qs(environ.get('QUERY_STRING', ''))
    status = '200 OK'

    if uwt:
        uwt = safe_int(uwt.group(1),0)
    else:
        uwt = 0

    if 'loc' in parameters:
        loc = parameters['loc'][0]
    else:
        loc = ''
    if 'key' in parameters:
        key = parameters['key'][0]
    else:
        key = ''
    if 'format' in parameters:
        of = parameters['format'][0]
    else:
        of = ''
    if 'fwv' in parameters:
        fwv = parameters['fwv'][0]
    else:
        fwv = ''

    maxh, minh, meant, pre, pre_today, h_today, sunrise, sunset, scale, toffset = [-1, -1, -500, -1, -1, -1, -1, -1, -1, -1]

    eip = IP2Int(getClientAddress(environ))

    # if loc is GPS coordinate itself
    sp = loc.split(',', 1)
    if len(sp)==2 and isFloat(sp[0]) and isFloat(sp[1]):
        lat = sp[0]
        lon = sp[1]
    else:
        lat = None
        lon = None

    # if loc is US 5+4 zip code, strip the last 4
    sp = loc.split('-', 1)
    if len(sp)==2 and isInt(sp[0]) and len(sp[0])==5 and isInt(sp[1]) and len(sp[1])==4:
        loc=sp[0]

    tzone = None
    # if loc is pws, query wunderground geolookup to get GPS coordinates
    if loc.startswith('pws:') or loc.startswith('icao:'):
        try:
            req = urllib2.urlopen('http://api.wunderground.com/api/'+key+'/geolookup/q/'+urllib.quote(loc)+'.json')
            dat = json.load(req)
            if dat['location']:
                v = dat['location']['lat']
                if v and isFloat(v):
                    lat = v
                v = dat['location']['lon']
                if v and isFloat(v):
                    lon = v
                v = dat['location']['tz_long']
                if v:
                    tzone = v
                else:
                    v = dat['location']['tz']
                    if v:
                        tzone = v

        except:
            lat = None
            lon = None
            tzone = None

    #loc = loc.replace(' ','_')

    # now do autocomplete lookup to get GPS coordinates
    if lat==None or lon==None:
        try:
            req = urllib2.urlopen('http://autocomplete.wunderground.com/aq?h=0&query='+urllib.quote(loc))
            dat = json.load(req)
            if dat['RESULTS']:
                v = dat['RESULTS'][0]['lat']
                if v and isFloat(v):
                    lat = v
                v = dat['RESULTS'][0]['lon']
                if v and isFloat(v):
                    lon = v
                v = dat['RESULTS'][0]['tz']
                if v:
                    tzone = v
                else:
                    v = dat['RESULTS'][0]['tz_long']
                    if v:
                        tzone = v

        except:
            lat = None
            lon = None
            tzone = None

    if (lat) and (lon):
        if not loc.startswith('pws:') and not loc.startswith('icao:'):
            loc = ''+lat+','+lon

        home = ephem.Observer()

        home.lat = lat
        home.long = lon

        sun = ephem.Sun()
        sun.compute(home)

        sunrise = calendar.timegm(home.next_rising(sun).datetime().utctimetuple())
        sunset = calendar.timegm(home.next_setting(sun).datetime().utctimetuple())

    if tzone:
        try:
            tnow = pytz.utc.localize(datetime.utcnow())
            tdelta = tnow.astimezone(pytz.timezone(tzone)).utcoffset()
            toffset = tdelta.days*96+tdelta.seconds/900+48;
        except:
            toffset=-1

    if (key != ''):
        try:
            req = urllib2.urlopen('http://api.wunderground.com/api/'+key+'/yesterday/conditions/q/'+urllib.quote(loc)+'.json')
            dat = json.load(req)

            if dat['history'] and dat['history']['dailysummary']:
                info = dat['history']['dailysummary'][0]
                if info:
                    v = info['maxhumidity']
                    if v:
                        maxh = safe_float(v, maxh)
                    v = info['minhumidity']
                    if v:
                        minh = safe_float(v, minh)
                    v = info['meantempi']
                    if v:
                        meant = safe_float(v, meant)
                    v = info['precipi']
                    if v:
                        pre = safe_float(v, pre)
            info = dat['current_observation']
            if info:
                v = info['precip_today_in']
                if v:
                    pre_today = safe_float(v, pre_today)
                v = info['relative_humidity'].replace('%','')
                if v:
                    h_today = safe_float(v, h_today)

            if ((uwt & ~(1 << 7)) == 1):
                # calculate water time scale, per https://github.com/rszimm/sprinklers_pi/blob/master/Weather.cpp
                hf = 0
                if (maxh>=0) and (minh>=0):
                    hf = 30 - (maxh+minh)/2
                #elif (h_today>=0):
                #  hf = 30 - h_today
                tf = 0
                if (meant > -500):
                    tf = (meant - 70) * 4
                rf = 0
                if (pre>=0):
                    rf -= pre * 200
                if (pre_today>=0):
                    rf -= pre_today * 200
                scale = (int)(100 + hf + tf + rf)

                if (scale<0):
                    scale = 0
                if (scale>200):
                    scale = 200

            # Check weather modifier bits and apply scale modification
            if ((uwt>>7) & 1):
                # California modification to prevent watering when rain has occured within 48 hours

                # Get before yesterday's weather data
                beforeYesterday = date.today() - timedelta(2)

                req = urllib2.urlopen('http://api.wunderground.com/api/'+key+'/history_'+beforeYesterday.strftime('%Y%m%d')+'/q/'+urllib.quote(loc)+'.json')
                dat = json.load(req)

                if dat['history'] and dat['history']['dailysummary']:
                    info = dat['history']['dailysummary'][0]
                    if info:
                        v = info['precipi']
                        if v:
                            pre_beforeYesterday = safe_float(v, -1)

                preTotal = pre_today + pre + pre_beforeYesterday

                if (preTotal > 0.01):
                    scale = 0
        except:
            pass

        urllib2.urlopen('https://ssl.google-analytics.com/collect?v=1&t=event&ec=weather&ea=lookup&el=results&ev='+str(scale)+'&cd1='+str(fwv)+'&cd2='+urllib.quote(loc)+'&cd3='+str(toffset)+'&cid=555&tid=UA-57507808-1&z='+str(time.time()))
    else:
        urllib2.urlopen('https://ssl.google-analytics.com/collect?v=1&t=event&ec=timezone&ea=lookup&el=results&ev='+str(toffset)+'&cd1='+str(fwv)+'&cd2='+urllib.quote(loc)+'&cid=555&tid=UA-57507808-1&z='+str(time.time()))

    # prepare sunrise sunset time
    delta = 3600/4*(toffset-48)
    if (sunrise >= 0):
        sunrise = int(((sunrise+delta)%86400)/60)
    if (sunset >= 0):
        sunset =  int(((sunset +delta)%86400)/60)

    if of=='json' or of=='JSON':
        output = '{"scale":%d, "tz":%d, "sunrise":%d, "sunset":%d, "maxh":%d, "minh":%d, "meant":%d, "pre":%f, "prec":%f, "hc":%d, "eip":%d}' % (scale, toffset, sunrise, sunset, int(maxh), int(minh), int(meant), pre, pre_today, int(h_today), eip)
    else:
        output = '&scale=%d&tz=%d&sunrise=%d&sunset=%d&maxh=%d&minh=%d&meant=%d&pre=%f&prec=%f&hc=%d&eip=%d' % (scale, toffset, sunrise, sunset, int(maxh), int(minh), int(meant), pre, pre_today, int(h_today), eip)

    response_headers = [('Content-type', 'text/plain'),('Content-Length', str(len(output)))]
    start_response(status, response_headers)

    return [output]

